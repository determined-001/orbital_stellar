/**
 * Backstop subscription lifecycle (issue #1067, "21.6 Backstop subscription
 * lifecycle and billing hooks").
 *
 * The rule that shapes this state machine is **notify before the lapse, never
 * after**. Silent lapse followed by a missed intervention is the worst possible
 * sequence for a product whose entire value proposition is *someone is
 * watching*: the subscriber must learn coverage is ending while they can still
 * do something about it.
 *
 * So `expiring` is a distinct state rather than a flag on `active`. It is
 * **covered** - grace is covered - it is entered on a schedule ahead of expiry,
 * and entering it fires {@link BillingHooks.onExpiring}. `lapsed` is reachable
 * *only* through `expiring`, so there is no code path in which a lapse happens
 * without a prior notification. That is enforced by {@link LEGAL_TRANSITIONS},
 * not by a comment asking contributors to remember it.
 *
 * Every transition writes its closed {@link CoverageWindow} to the append-only
 * coverage ledger **before** the new state takes effect, so the record is never
 * behind the state.
 *
 * See `docs/design/backstop-subscription-lifecycle.md`.
 */

import type { BillingHooks, ExpiringSubscriptionEvent, SubscriptionEvent } from "./billing.js";
import { NOOP_BILLING_HOOKS } from "./billing.js";
import type { CoverageLedger, CoverageReason, CoverageWindow } from "./coverage.js";

export type SubscriptionState = "active" | "expiring" | "lapsed" | "cancelled";

/**
 * The only transitions that exist. A transition outside this table is a
 * programming error and throws rather than being coerced into something
 * plausible.
 *
 * Note what is absent: `active -> lapsed`. Coverage cannot end without passing
 * through `expiring`, and `expiring` is what notifies.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<SubscriptionState, readonly SubscriptionState[]>> =
  Object.freeze({
    active: Object.freeze(["expiring", "cancelled"] as const),
    expiring: Object.freeze(["active", "lapsed"] as const),
    lapsed: Object.freeze(["active"] as const),
    cancelled: Object.freeze(["active"] as const),
  });

const COVERED_STATES: ReadonlySet<SubscriptionState> = new Set<SubscriptionState>([
  "active",
  "expiring",
]);

const REASON_BY_STATE: Readonly<Record<SubscriptionState, CoverageReason>> = Object.freeze({
  active: "active",
  expiring: "grace",
  lapsed: "lapsed",
  cancelled: "cancelled",
});

/** Whether a subscription in this state is backstopped. Grace counts as covered. */
export function isCoveredState(state: SubscriptionState): boolean {
  return COVERED_STATES.has(state);
}

/** Whether `from -> to` appears in {@link LEGAL_TRANSITIONS}. */
export function isLegalTransition(from: SubscriptionState, to: SubscriptionState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export type SubscriptionLifecycleErrorCode =
  | "ILLEGAL_TRANSITION"
  | "LEDGER_NOT_ADVANCING"
  | "LEDGER_OUT_OF_RANGE"
  | "INVALID_WINDOW_SIZE"
  | "INSUFFICIENT_LAPSE_NOTICE"
  | "PREMATURE_LAPSE"
  | "MISSING_FIELD";

export class SubscriptionLifecycleError extends Error {
  readonly code: SubscriptionLifecycleErrorCode;

  constructor(code: SubscriptionLifecycleErrorCode, message: string) {
    super(message);
    this.name = "SubscriptionLifecycleError";
    this.code = code;
  }
}

export type BackstopSubscriptionConfig = {
  subscriptionId: string;
  /**
   * The backstop tier being subscribed to. Typed as `string` rather than a
   * union because tier identifiers come from latency-tier configuration
   * (21.3, #1064); a union here would have to be rewritten when that lands.
   */
  tier: string;
  /**
   * The length of one backstop window, in ledgers. It is required rather than
   * defaulted because two guarantees are stated in units of it: a lapse is
   * announced at least one full window ahead, and a lapsed subscription stops
   * being backstopped within one window.
   */
  windowLedgers: number;
  /** The append-only coverage record. */
  coverage: CoverageLedger;
  /** Defaults to {@link NOOP_BILLING_HOOKS} - an unbilled, working backstop. */
  hooks?: BillingHooks;
};

function assertLedger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SubscriptionLifecycleError(
      "LEDGER_OUT_OF_RANGE",
      `${label} must be a non-negative safe integer, got ${String(value)}`,
    );
  }
}

/**
 * One backstop subscription and its coverage record.
 *
 * The object holds the current state; the ledger holds the history. Reads that
 * have to survive the object - "was this subscription covered at ledger N",
 * asked months later about a subscription that has since lapsed - go to the
 * ledger via `coverageForWindow` / `wasCovered`, never to this class.
 */
export class BackstopSubscription {
  readonly subscriptionId: string;
  readonly tier: string;
  readonly windowLedgers: number;

  private readonly coverage: CoverageLedger;
  private readonly hooks: BillingHooks;

  private currentState: SubscriptionState;
  /** Start of the open, not-yet-recorded stretch of ledgers. */
  private openedAt: number;
  /** Set while `expiring`: the ledger coverage was announced to end at. */
  private announcedLapseLedger: number | null = null;

  private constructor(config: BackstopSubscriptionConfig, atLedger: number) {
    this.subscriptionId = config.subscriptionId;
    this.tier = config.tier;
    this.windowLedgers = config.windowLedgers;
    this.coverage = config.coverage;
    this.hooks = config.hooks ?? NOOP_BILLING_HOOKS;
    this.currentState = "active";
    this.openedAt = atLedger;
  }

  /**
   * Activate a new subscription at `atLedger`. This is the only way in: there
   * is no constructor that yields an inactive subscription, so no caller can
   * assemble one in a state the transition table does not describe.
   */
  static async activate(
    config: BackstopSubscriptionConfig,
    atLedger: number,
  ): Promise<BackstopSubscription> {
    if (!config.subscriptionId) {
      throw new SubscriptionLifecycleError("MISSING_FIELD", "subscriptionId is required");
    }
    if (!config.tier) {
      throw new SubscriptionLifecycleError("MISSING_FIELD", "tier is required");
    }
    if (!Number.isSafeInteger(config.windowLedgers) || config.windowLedgers < 1) {
      throw new SubscriptionLifecycleError(
        "INVALID_WINDOW_SIZE",
        `windowLedgers must be a positive safe integer, got ${String(config.windowLedgers)}`,
      );
    }
    assertLedger(atLedger, "atLedger");

    const subscription = new BackstopSubscription(config, atLedger);
    // Coverage starts here, so there is no closed window to report. `null`
    // rather than a zero-length record: the ledger would reject that record,
    // and an event should not carry a shape the store would refuse.
    await subscription.fire("onActivated", subscription.event(atLedger, null));
    return subscription;
  }

  get state(): SubscriptionState {
    return this.currentState;
  }

  /** Whether the subscription is backstopped right now. */
  get covered(): boolean {
    return isCoveredState(this.currentState);
  }

  /** The first ledger of the open, not-yet-recorded stretch. */
  get openLedger(): number {
    return this.openedAt;
  }

  /** The announced lapse ledger while `expiring`, else `null`. */
  get lapsesAtLedger(): number | null {
    return this.announcedLapseLedger;
  }

  /** Renew from `expiring` back to `active`, cancelling the announced lapse. */
  async renew(atLedger: number): Promise<void> {
    const window = await this.transition("active", atLedger);
    this.announcedLapseLedger = null;
    await this.fire("onRenewed", this.event(atLedger, window));
  }

  /**
   * Announce that coverage ends at `lapsesAtLedger` and enter grace. Grace is
   * covered; the subscriber is notified now, not at the lapse.
   *
   * The notice must be at least one full window ahead, otherwise it is not a
   * notice - it is an announcement made too late for the subscriber to act on,
   * which is the failure this state exists to prevent.
   */
  async beginExpiring(atLedger: number, lapsesAtLedger: number): Promise<void> {
    assertLedger(atLedger, "atLedger");
    assertLedger(lapsesAtLedger, "lapsesAtLedger");

    if (lapsesAtLedger - atLedger < this.windowLedgers) {
      throw new SubscriptionLifecycleError(
        "INSUFFICIENT_LAPSE_NOTICE",
        `A lapse must be announced at least one window (${this.windowLedgers} ledgers) ahead: ` +
          `announced at ${atLedger}, lapsing at ${lapsesAtLedger}`,
      );
    }

    const window = await this.transition("expiring", atLedger);
    this.announcedLapseLedger = lapsesAtLedger;
    const event: ExpiringSubscriptionEvent = {
      ...this.event(atLedger, window),
      lapsesAtLedger,
    };
    await this.fire("onExpiring", event);
  }

  /**
   * Lapse. Only reachable from `expiring`, and never before the ledger the
   * subscriber was told about - a lapse earlier than announced would make the
   * notice a lie.
   */
  async lapse(atLedger: number): Promise<void> {
    assertLedger(atLedger, "atLedger");

    if (this.announcedLapseLedger !== null && atLedger < this.announcedLapseLedger) {
      throw new SubscriptionLifecycleError(
        "PREMATURE_LAPSE",
        `Coverage was announced to end at ledger ${this.announcedLapseLedger}; ` +
          `cannot lapse at ${atLedger}`,
      );
    }

    const window = await this.transition("lapsed", atLedger);
    this.announcedLapseLedger = null;
    await this.fire("onLapsed", this.event(atLedger, window));
  }

  /** Cancel at the subscriber's request. Coverage ends immediately; no grace. */
  async cancel(atLedger: number): Promise<void> {
    const window = await this.transition("cancelled", atLedger);
    this.announcedLapseLedger = null;
    await this.fire("onCancelled", this.event(atLedger, window));
  }

  /** Bring a `lapsed` or `cancelled` subscription back to `active`. */
  async reactivate(atLedger: number): Promise<void> {
    const window = await this.transition("active", atLedger);
    await this.fire("onActivated", this.event(atLedger, window));
  }

  /**
   * Close the open stretch at `atLedger` and reopen from there, without
   * changing state or firing a hook.
   *
   * This is what makes *any* window answerable from stored records rather than
   * only the windows that happen to contain a transition: the backstop watcher
   * (21.1, #1062) seals at each window boundary, so the record is complete up
   * to the ledger it has processed.
   */
  async sealTo(atLedger: number): Promise<CoverageWindow> {
    return this.writeOpenWindow(atLedger);
  }

  /**
   * Writes the open stretch `[openedAt, atLedger)` to the ledger with the
   * *current* state's coverage, then reopens from `atLedger`.
   */
  private async writeOpenWindow(atLedger: number): Promise<CoverageWindow> {
    assertLedger(atLedger, "atLedger");
    if (atLedger <= this.openedAt) {
      throw new SubscriptionLifecycleError(
        "LEDGER_NOT_ADVANCING",
        `Ledger must advance past the open window start ${this.openedAt}, got ${atLedger}`,
      );
    }

    const window: CoverageWindow = {
      subscriptionId: this.subscriptionId,
      startLedger: this.openedAt,
      endLedger: atLedger,
      covered: isCoveredState(this.currentState),
      reason: REASON_BY_STATE[this.currentState],
    };

    // Written before the state moves, so the record is never behind the state.
    await this.coverage.append(window);
    this.openedAt = atLedger;
    return window;
  }

  private async transition(to: SubscriptionState, atLedger: number): Promise<CoverageWindow> {
    if (!isLegalTransition(this.currentState, to)) {
      throw new SubscriptionLifecycleError(
        "ILLEGAL_TRANSITION",
        `${this.currentState} -> ${to} is not a legal subscription transition`,
      );
    }

    const window = await this.writeOpenWindow(atLedger);
    this.currentState = to;
    return window;
  }

  private event(atLedger: number, window: CoverageWindow | null): SubscriptionEvent {
    return {
      subscriptionId: this.subscriptionId,
      tier: this.tier,
      atLedger,
      window,
    };
  }

  private async fire(hook: "onExpiring", event: ExpiringSubscriptionEvent): Promise<void>;
  private async fire(
    hook: "onActivated" | "onRenewed" | "onLapsed" | "onCancelled",
    event: SubscriptionEvent,
  ): Promise<void>;
  private async fire(
    hook: keyof BillingHooks,
    event: SubscriptionEvent | ExpiringSubscriptionEvent,
  ): Promise<void> {
    if (hook === "onExpiring") {
      await this.hooks.onExpiring(event as ExpiringSubscriptionEvent);
      return;
    }
    await this.hooks[hook](event);
  }
}
