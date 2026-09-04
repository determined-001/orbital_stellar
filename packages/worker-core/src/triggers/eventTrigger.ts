/**
 * The event-based trigger class (issue 20.6).
 *
 * Second trigger class from §C.1: run on an on-chain occurrence. A condition
 * is a predicate over `NormalizedEvent` (see `predicate.ts`), and this module
 * turns a stream of normalized events into an ordered list of *fire decisions*
 * — each one a window 19.1 can later score without a new code path.
 *
 * Two properties are load-bearing and everything here is arranged around them:
 *
 *   **Determinism.** The same ledger range must always produce the same
 *   decisions. That is what lets 19.1 say "should have fired" about a range it
 *   is replaying later. Nothing in this module reads a clock, a network, or any
 *   state outside its arguments.
 *
 *   **Fire-once.** A duplicated source event — a re-delivery, or the same
 *   ledger re-scanned after a reorg — must not double-fire. That is 18.6's
 *   job; this module states the seam it needs ({@link FireClaimStore}) and
 *   defers to it, rather than inventing a second idempotency mechanism.
 */
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import type { ClaimStore } from "../idempotency.js";
import { compileEventCondition } from "./predicate.js";
import type { EventConditionSpec, EventPredicate } from "./predicate.js";

/**
 * The subset of a worker manifest (20.4) this trigger class needs.
 *
 * 20.4 has since landed (`../manifest.js`), and this is still its own type —
 * for two reasons that are worth stating rather than leaving as an oversight:
 *
 *  - `TriggerSpec` there is `CronTrigger` and nothing else ("only `cron` is
 *    defined in v1"), so there is no `event` member for this to be a `Pick<>`
 *    of yet. Adding one is 20.4's change to make, not this issue's.
 *  - The manifest's `LatencyBound` is in **seconds**; this bound is in
 *    **ledgers**, as this issue's acceptance criteria specify. That is not a
 *    stylistic difference: seconds are wall-clock, and a replay scored against
 *    wall-clock is not deterministic, which is the property this whole module
 *    exists to provide. Ledgers are the unit 19.1 can recompute from chain
 *    data alone.
 *
 * The two want reconciling in 20.4 — an `event` trigger spec whose bound is
 * ledger-denominated — and until then the field names here match what the
 * acceptance criteria describe.
 */
export type EventTriggerDefinition = {
  /** Stable identity of the worker this trigger belongs to. */
  readonly workerId: string;
  /** The declarative condition. Compiled once at registration. */
  readonly condition: EventConditionSpec;
  /**
   * How many ledgers after the triggering event the invocation must land in.
   *
   * The acceptance requires the bound to be *declared in the manifest* rather
   * than assumed, because 19.1 measures `late` against it and a bound the
   * operator never stated is not one they can be held to.
   */
  readonly latencyBoundLedgers: number;
  /**
   * First ledger at which this definition is in effect.
   *
   * Verification uses it to avoid manufacturing a history of misses for
   * windows that closed before the worker existed (19.1 §3, cause 3).
   */
  readonly activationLedger: number;
};

/**
 * One window: a condition occurrence and the deadline it created.
 *
 * This is the shape 19.1 scores. It deliberately carries no verdict — planning
 * says what was owed, verification says what happened, and keeping them apart
 * is what lets a verdict be recomputed from chain data alone.
 */
export type FireDecision = {
  /**
   * Deterministic window identity: worker plus the source event's own id.
   *
   * Derived from the event rather than from a counter or a timestamp, so a
   * replay of the same range produces the same ids — which is what makes a
   * stored verdict addressable across runs.
   */
  readonly windowId: string;
  readonly workerId: string;
  /** The event that opened the window. */
  readonly conditionEventId: string;
  /** Ledger the condition was observed at. */
  readonly conditionLedger: number;
  /** Last ledger by which the invocation must land. */
  readonly deadlineLedger: number;
};

/** Why an event that satisfied the predicate did not open a window. */
export type SkipReason =
  /** A window for this exact source event already existed (re-delivery or reorg re-scan). */
  | "duplicate"
  /** Another window for this worker is already open and undeadlined at this ledger. */
  | "window-already-open"
  /** The event predates the definition's activation ledger. */
  | "before-activation"
  /** The event carries no `ledger`, so no window boundary can be computed. */
  | "missing-ledger"
  /** The event carries no stable identity, so a re-delivery could not be recognised. */
  | "missing-event-id";

export type SkippedEvent = {
  readonly reason: SkipReason;
  readonly conditionEventId: string | null;
  readonly conditionLedger: number | null;
};

export type PlanResult = {
  readonly decisions: ReadonlyArray<FireDecision>;
  /**
   * Events that matched the condition but opened no window, with the reason.
   *
   * Returned rather than dropped: "matched but skipped" and "did not match"
   * are different facts about a worker, and an operator debugging a trigger
   * that never fires needs to be able to tell them apart.
   */
  readonly skipped: ReadonlyArray<SkippedEvent>;
};

/**
 * The idempotency seam owned by 18.6 (fire-once per worker window).
 *
 * 18.6 has since landed as {@link ClaimStore} / {@link IdempotencyManager} in
 * `../idempotency.js`, whose claims carry an owner and a TTL. This narrower
 * port stays because planning only ever asks two questions — *did I win this
 * window* and *has anyone taken it* — and a planner that had to invent an
 * owner id and a lease duration to ask them would be doing the executor's job.
 *
 * {@link ClaimStoreFireClaims} adapts one to the other, so there is exactly
 * one claim protocol in the package rather than two that can disagree. 21.1's
 * backstop converges on the same store, which is what stops a backstop
 * double-firing against a primary that fired late.
 */
export interface FireClaimStore {
  /**
   * Claim a window. Returns true if this caller won it, false if it was
   * already claimed. Must be atomic with respect to concurrent callers.
   */
  claim(windowId: string): Promise<boolean> | boolean;
  /** Has this window already been claimed by anyone? */
  isClaimed(windowId: string): Promise<boolean> | boolean;
}

/**
 * In-memory reference implementation, for tests and single-process runs.
 *
 * Not the production store: it has no durability and no cross-process
 * atomicity, both of which 18.6 owes. Named so that is obvious at the call
 * site.
 */
export class InMemoryFireClaimStore implements FireClaimStore {
  private readonly claimed = new Set<string>();

  claim(windowId: string): boolean {
    if (this.claimed.has(windowId)) return false;
    this.claimed.add(windowId);
    return true;
  }

  isClaimed(windowId: string): boolean {
    return this.claimed.has(windowId);
  }
}

/**
 * Adapts 18.6's {@link ClaimStore} to this module's narrower
 * {@link FireClaimStore}, so an event trigger and a time trigger contend for
 * the same claim rather than each holding their own idea of "already fired".
 *
 * `ownerId` is who this planner claims as, and `claimTtlMs` is how long an
 * unreleased claim is honoured — both belong to the executor, not to planning,
 * which is why they are constructor arguments here rather than parameters on
 * {@link FireClaimStore.claim}.
 */
export class ClaimStoreFireClaims implements FireClaimStore {
  constructor(
    private readonly store: ClaimStore,
    private readonly ownerId: string,
    private readonly claimTtlMs = 5 * 60_000,
  ) {
    if (!Number.isFinite(claimTtlMs) || claimTtlMs <= 0) {
      throw new Error(`claimTtlMs must be positive, got ${String(claimTtlMs)}`);
    }
    if (!ownerId) {
      throw new Error("ownerId is required: an unowned claim cannot be released");
    }
  }

  async claim(windowId: string): Promise<boolean> {
    return this.store.claim(windowId, this.ownerId, this.claimTtlMs);
  }

  async isClaimed(windowId: string): Promise<boolean> {
    return (await this.store.get(windowId)) !== null;
  }
}

/**
 * A source event's stable identity.
 *
 * `eventId` when the source gave one, otherwise the transaction hash plus the
 * ledger. Returns null rather than synthesising an id from an index or a
 * timestamp: a fabricated id is not stable across a re-scan, so it would
 * defeat the very duplicate detection it appears to enable.
 */
export function eventIdentity(event: NormalizedEvent): string | null {
  const record = event as unknown as { eventId?: string; txHash?: string; ledger?: number };
  if (typeof record.eventId === "string" && record.eventId.length > 0) return record.eventId;
  if (
    typeof record.txHash === "string" &&
    record.txHash.length > 0 &&
    record.ledger !== undefined
  ) {
    return `${record.txHash}:${record.ledger}`;
  }
  return null;
}

function ledgerOf(event: NormalizedEvent): number | null {
  const ledger = (event as unknown as { ledger?: number }).ledger;
  return typeof ledger === "number" && Number.isFinite(ledger) ? ledger : null;
}

/**
 * A compiled, registered event trigger.
 *
 * Construct with {@link registerEventTrigger}, which is where the
 * registration-time gates run. There is deliberately no public constructor
 * that skips them.
 */
export class EventTriggerPlanner {
  private constructor(
    readonly definition: EventTriggerDefinition,
    private readonly predicate: EventPredicate,
  ) {}

  /** @internal — use {@link registerEventTrigger}. */
  static _create(
    definition: EventTriggerDefinition,
    predicate: EventPredicate,
  ): EventTriggerPlanner {
    return new EventTriggerPlanner(definition, predicate);
  }

  /** Does this event satisfy the trigger's condition? Pure. */
  matches(event: NormalizedEvent): boolean {
    return this.predicate(event);
  }

  /**
   * Plan the windows a batch of events opens.
   *
   * Pure and synchronous: given the same events in the same order, it returns
   * the same decisions, every time. Claiming (which is stateful, and 18.6's)
   * is a separate step — see {@link claimDecisions} — so that replay can
   * exercise planning without touching a store.
   *
   * Events are processed in ledger order. A caller handing them in a different
   * order gets them sorted here rather than a different answer, because "the
   * same ledger range yields identical decisions" must not depend on the order
   * a source happened to deliver in.
   */
  plan(events: ReadonlyArray<NormalizedEvent>): PlanResult {
    const decisions: FireDecision[] = [];
    const skipped: SkippedEvent[] = [];
    const seen = new Set<string>();
    let openUntilLedger: number | null = null;

    const ordered = [...events]
      .map((event, index) => ({ event, index }))
      .sort((a, b) => {
        const ledgerDiff = (ledgerOf(a.event) ?? 0) - (ledgerOf(b.event) ?? 0);
        if (ledgerDiff !== 0) return ledgerDiff;
        // Stable within a ledger: preserve delivery order rather than letting
        // an unspecified sort decide which of two same-ledger events wins.
        return a.index - b.index;
      })
      .map(({ event }) => event);

    for (const event of ordered) {
      if (!this.predicate(event)) continue;

      const ledger = ledgerOf(event);
      if (ledger === null) {
        skipped.push({
          reason: "missing-ledger",
          conditionEventId: eventIdentity(event),
          conditionLedger: null,
        });
        continue;
      }

      const identity = eventIdentity(event);
      if (identity === null) {
        skipped.push({
          reason: "missing-event-id",
          conditionEventId: null,
          conditionLedger: ledger,
        });
        continue;
      }

      if (ledger < this.definition.activationLedger) {
        skipped.push({
          reason: "before-activation",
          conditionEventId: identity,
          conditionLedger: ledger,
        });
        continue;
      }

      if (seen.has(identity)) {
        skipped.push({ reason: "duplicate", conditionEventId: identity, conditionLedger: ledger });
        continue;
      }
      seen.add(identity);

      // A condition recurring inside an open window is one obligation, not two
      // (19.1 §3, cause 4). Without this, a burst of source events fabricates a
      // run of misses from a worker that behaved correctly.
      if (openUntilLedger !== null && ledger <= openUntilLedger) {
        skipped.push({
          reason: "window-already-open",
          conditionEventId: identity,
          conditionLedger: ledger,
        });
        continue;
      }

      const deadlineLedger = ledger + this.definition.latencyBoundLedgers;
      openUntilLedger = deadlineLedger;

      decisions.push({
        windowId: `${this.definition.workerId}:${identity}`,
        workerId: this.definition.workerId,
        conditionEventId: identity,
        conditionLedger: ledger,
        deadlineLedger,
      });
    }

    return { decisions, skipped };
  }

  /**
   * Claim planned windows through 18.6's store, returning only those this
   * caller won.
   *
   * Separate from {@link plan} on purpose. Planning is the deterministic part
   * and is what a replay test asserts on; claiming is the part that must not
   * double-fire across processes and restarts, and is the only part that
   * touches state.
   */
  async claimDecisions(
    decisions: ReadonlyArray<FireDecision>,
    store: FireClaimStore,
  ): Promise<FireDecision[]> {
    const won: FireDecision[] = [];
    for (const decision of decisions) {
      if (await store.claim(decision.windowId)) won.push(decision);
    }
    return won;
  }
}

export type RegisterResult =
  | { readonly ok: true; readonly trigger: EventTriggerPlanner }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Register an event trigger, running every registration-time gate.
 *
 * Gates are refusals, not warnings — including the trade-signal refusal, which
 * is how §C.1's fixed build order is enforced against a well-meaning
 * contributor rather than merely documented at them.
 */
export function registerEventTrigger(definition: EventTriggerDefinition): RegisterResult {
  const errors: string[] = [];

  if (!definition.workerId || definition.workerId.trim().length === 0) {
    errors.push("workerId is required");
  }

  if (!Number.isInteger(definition.latencyBoundLedgers) || definition.latencyBoundLedgers <= 0) {
    errors.push(
      "latencyBoundLedgers must be a positive integer — 19.1 measures `late` against it, " +
        "and a bound that was never declared is not one an operator can be held to",
    );
  }

  if (!Number.isInteger(definition.activationLedger) || definition.activationLedger < 0) {
    errors.push("activationLedger must be a non-negative integer");
  }

  const compiled = compileEventCondition(definition.condition);
  if (!compiled.ok) errors.push(...compiled.errors);

  if (errors.length > 0 || !compiled.ok) return { ok: false, errors };

  return { ok: true, trigger: EventTriggerPlanner._create(definition, compiled.predicate) };
}
