/**
 * Backstop watcher (issue 21.1) — detect a miss and fire the fallback.
 *
 * §C.7's mechanism. If a registered external worker fails to fire, an Orbital
 * worker catches the miss and triggers the contract itself.
 *
 * **The economics to keep in view**: the cost is readiness, not payouts.
 * Catching a miss means watching the same condition continuously for every
 * backstopped subscription, so monitoring cost scales with *subscriptions*, not
 * with failures. {@link BackstopWatcher.stats} exposes that from day one rather
 * than waiting for 21.2 to retrofit it — a cost model added after the fact
 * measures whatever the implementation happened to do.
 *
 * **The central correctness problem** is the double-fire race. The backstop and
 * the primary are two independent processes converging on one window. This
 * module does not attempt to solve that with timing; it converges on 18.6's
 * claim protocol using the *same window id the primary uses*, so the race is
 * decided by one atomic claim rather than by who noticed first.
 */
import type { FireClaimStore, FireDecision } from "../triggers/eventTrigger.js";
import type { WindowVerdict, WindowVerdictSource } from "./windowVerdict.js";
import type { Intervention, InterventionNotifier, InterventionRecorder } from "./intervention.js";

/**
 * Latency tiers a subscription can be registered at.
 *
 * W3 covers time-insensitive tiers only — payroll, periodic settlement, where a
 * fallback firing an hour late is a non-event. Anything latency-sensitive waits
 * for 22.4.
 */
export type LatencyTier = "time-insensitive" | "latency-sensitive";

export const LATENCY_SENSITIVE_REJECTION =
  "W3 backstops cover time-insensitive tiers only — payroll, periodic settlement, " +
  "where a fallback firing an hour late is a non-event. A latency-sensitive tier " +
  "needs the guarantees tracked in 22.4. Start with the cheap tier and earn your " +
  "way to the expensive one (§C.7).";

/**
 * The subset of a subscription (20.5) the backstop needs.
 *
 * Declared here rather than imported because 20.5 is still open. Field names
 * follow the acceptance criteria's wording so the eventual `Pick<>` is
 * mechanical.
 */
/**
 * What the watcher needs to know about a subscription it is backstopping.
 *
 * Deliberately narrower than #1067's `BackstopSubscription` lifecycle object,
 * and named differently so the two do not collide: that one owns state
 * transitions, coverage records and billing hooks; this one is the handful of
 * fields evaluating a single window actually reads.
 */
export type WatchedSubscription = {
  readonly subscriptionId: string;
  readonly workerId: string;
  readonly tier: LatencyTier;
  /**
   * Ledgers to wait past the primary's declared deadline before intervening.
   *
   * Per-subscription and derived from the manifest's latency bound (20.4), not
   * a global constant: a worker with a 10-ledger bound and one with a
   * 10,000-ledger bound have nothing useful in common, and one shared number
   * would either intervene too early on the slow one or far too late on the
   * fast one.
   */
  readonly graceLedgers: number;
};

/** How the backstop actually submits the fallback invocation. 18.5 owns the implementation. */
export interface FallbackSubmitter {
  /** Submit the fallback for `decision`. Throws to signal a failed submission. */
  submit(decision: FireDecision): Promise<void> | void;
}

export type RegisterBackstopResult =
  | { readonly ok: true; readonly subscription: WatchedSubscription }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Register a subscription for backstopping.
 *
 * The latency-tier refusal is a gate, not a warning: it is what enforces
 * "start with the cheap tier and earn your way to the expensive one" (§C.7),
 * and a warning would leave a latency-sensitive subscription running against
 * guarantees W3 does not have.
 */
export function registerBackstop(subscription: WatchedSubscription): RegisterBackstopResult {
  const errors: string[] = [];

  if (!subscription.subscriptionId || subscription.subscriptionId.trim().length === 0) {
    errors.push("subscriptionId is required");
  }
  if (!subscription.workerId || subscription.workerId.trim().length === 0) {
    errors.push("workerId is required");
  }
  if (subscription.tier === "latency-sensitive") {
    errors.push(LATENCY_SENSITIVE_REJECTION);
  }
  if (!Number.isInteger(subscription.graceLedgers) || subscription.graceLedgers < 0) {
    errors.push(
      "graceLedgers must be a non-negative integer, derived per-subscription from the " +
        "manifest's latency bound rather than a global constant",
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, subscription };
}

/** What the watcher did with one window. */
export type BackstopOutcome =
  /** Deadline plus grace has not elapsed — the primary still has time. */
  | { readonly kind: "waiting"; readonly windowId: string; readonly firesAtLedger: number }
  /** Verification says the window needs no intervention. */
  | { readonly kind: "no-intervention"; readonly windowId: string; readonly verdict: WindowVerdict }
  /** The primary claimed the window first — it fired, possibly late. No double-fire. */
  | { readonly kind: "primary-won"; readonly windowId: string }
  /** The backstop claimed the window and submitted the fallback. */
  | { readonly kind: "intervened"; readonly windowId: string; readonly intervention: Intervention }
  /** The backstop won the claim but submission failed. */
  | { readonly kind: "submission-failed"; readonly windowId: string; readonly error: Error };

export type BackstopStats = {
  /** Windows examined. This is the readiness cost — it scales with subscriptions, not failures. */
  readonly windowsWatched: number;
  /** Windows still inside deadline-plus-grace. */
  readonly windowsWaiting: number;
  /** Windows verification said needed nothing. */
  readonly windowsNoIntervention: number;
  /** Windows the primary claimed first. */
  readonly windowsPrimaryWon: number;
  /** Fallbacks actually fired. */
  readonly interventions: number;
  /** Claims won where submission then failed. */
  readonly submissionFailures: number;
};

export type BackstopDeps = {
  readonly verdicts: WindowVerdictSource;
  /** The same store the primary claims through. Sharing it is what prevents the double fire. */
  readonly claims: FireClaimStore;
  readonly submitter: FallbackSubmitter;
  readonly recorder: InterventionRecorder;
  readonly notifier?: InterventionNotifier;
};

/**
 * Watches the windows a primary worker was supposed to serve, and fires the
 * fallback for the ones it missed.
 *
 * Consumes the same {@link FireDecision} windows the trigger class plans, so
 * the backstop and the primary are reasoning about identical windows rather
 * than two similar-looking sets.
 */
export class BackstopWatcher {
  private windowsWatched = 0;
  private windowsWaiting = 0;
  private windowsNoIntervention = 0;
  private windowsPrimaryWon = 0;
  private interventions = 0;
  private submissionFailures = 0;

  constructor(
    private readonly subscription: WatchedSubscription,
    private readonly deps: BackstopDeps,
  ) {}

  get stats(): BackstopStats {
    return {
      windowsWatched: this.windowsWatched,
      windowsWaiting: this.windowsWaiting,
      windowsNoIntervention: this.windowsNoIntervention,
      windowsPrimaryWon: this.windowsPrimaryWon,
      interventions: this.interventions,
      submissionFailures: this.submissionFailures,
    };
  }

  /**
   * Evaluate one window at `currentLedger`.
   *
   * Order matters and is deliberate:
   *
   *   1. **Wait** until the primary's declared deadline plus this
   *      subscription's grace has passed. Firing before then would race a
   *      primary that is merely late, which W3 explicitly tolerates.
   *   2. **Ask verification**, rather than deciding independently. A backstop
   *      with its own private notion of "missed" would intervene on windows
   *      19.1 scores differently, and the divergence would surface as
   *      unexplained interventions.
   *   3. **Claim**, and only fire if the claim is won. This is the double-fire
   *      guard, and it is a claim rather than a re-check because a re-check has
   *      a window between looking and acting.
   */
  async evaluate(decision: FireDecision, currentLedger: number): Promise<BackstopOutcome> {
    this.windowsWatched += 1;

    const firesAtLedger = decision.deadlineLedger + this.subscription.graceLedgers;
    if (currentLedger <= firesAtLedger) {
      this.windowsWaiting += 1;
      return { kind: "waiting", windowId: decision.windowId, firesAtLedger };
    }

    const verdict = await this.deps.verdicts.verdictFor(decision.windowId, currentLedger);

    // Intervene only on a definite miss. `late` means the primary fired and the
    // contract call already happened; `pending` and `unverifiable` are not
    // grounds to act, and `not-due` means nothing was owed in the first place.
    if (!verdict || verdict.verdict !== "missed") {
      this.windowsNoIntervention += 1;
      return {
        kind: "no-intervention",
        windowId: decision.windowId,
        verdict: verdict ?? {
          windowId: decision.windowId,
          workerId: decision.workerId,
          verdict: "unverifiable",
          conditionLedger: decision.conditionLedger,
          deadlineLedger: decision.deadlineLedger,
        },
      };
    }

    // The one atomic step. If the primary fired late and claimed this window —
    // even a ledger ago — the claim fails here and the backstop stands down.
    const won = await this.deps.claims.claim(decision.windowId);
    if (!won) {
      this.windowsPrimaryWon += 1;
      return { kind: "primary-won", windowId: decision.windowId };
    }

    const intervention: Intervention = {
      windowId: decision.windowId,
      workerId: decision.workerId,
      subscriptionId: this.subscription.subscriptionId,
      cause: "primary-missed",
      verdict,
      decidedAtLedger: currentLedger,
      primaryDeadlineLedger: decision.deadlineLedger,
      graceLedgers: this.subscription.graceLedgers,
    };

    try {
      await this.deps.submitter.submit(decision);
    } catch (cause) {
      this.submissionFailures += 1;
      // Recorded even though the submission failed: the window is claimed and
      // therefore closed to both parties, and an operator asking why nothing
      // fired needs to find this rather than silence.
      await this.deps.recorder.record(intervention);
      return {
        kind: "submission-failed",
        windowId: decision.windowId,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      };
    }

    // Record before notifying. Recording is the audit trail and must not be
    // skipped; notification is delivery, and a webhook outage must not lose the
    // record of what Orbital did on a subscriber's behalf.
    await this.deps.recorder.record(intervention);
    this.interventions += 1;

    if (this.deps.notifier) {
      try {
        await this.deps.notifier.notify(intervention);
      } catch {
        // A failed notification does not un-fire the fallback, and must not
        // turn a successful intervention into a reported failure. 18.11 owns
        // delivery retries.
      }
    }

    return { kind: "intervened", windowId: decision.windowId, intervention };
  }

  /** Evaluate a batch of windows in order. */
  async evaluateAll(
    decisions: ReadonlyArray<FireDecision>,
    currentLedger: number,
  ): Promise<BackstopOutcome[]> {
    const outcomes: BackstopOutcome[] = [];
    for (const decision of decisions) {
      outcomes.push(await this.evaluate(decision, currentLedger));
    }
    return outcomes;
  }
}
