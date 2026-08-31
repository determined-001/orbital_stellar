/**
 * Hot-path execution types (issue #1071, "22.4 Latency-sensitive execution
 * path").
 *
 * NOTE ON SCOPE: this is a standalone stub. The issue depends on #1064
 * ("21.3 Latency-tier configuration") and #1070 ("22.3 Copy-trade worker on
 * the vault pattern"), both open and unimplemented, and on the submitter
 * (18.5) and RPC/simulation layers that would actually execute a plan - none
 * of which exist in this repo yet. Nothing here submits a transaction. What
 * this module provides is the structural boundary the acceptance criteria
 * ask for ("pre-signed where safe" needs a written boundary; "the code
 * should make the distinction structural") plus the measurement shape the
 * scorecards need, so that whatever eventually executes a `HotPathPlan` has
 * no way to pre-sign a plan whose arguments depend on observed state.
 *
 * Backpressure: this module deliberately does not define its own queue.
 * `packages/pulse-core/src/EventEngine.ts` already implements bounded-queue
 * backpressure (`CoreConfig.queue`, the `engine.backpressure` notification) -
 * per the acceptance criterion ("Backpressure under burst load handled per
 * #921 rather than a parallel mechanism"), a real hot-path submitter must
 * observe conditions through that existing mechanism, not a second one. This
 * package has no dependency on `pulse-core` yet because there is no real
 * consumer of one here; that dependency belongs in the real implementation,
 * not in this stub.
 */

import type { ArgBuilder, ChainState } from "../types.js";

/**
 * A ledger-count budget, not a wall-clock one: "declared ledger budget" in
 * the acceptance criteria, because ledger close time is the unit Stellar
 * finality is actually measured in.
 */
export interface LatencyBudget {
  /** Maximum ledgers allowed between the triggering condition and submission. */
  maxLedgers: number;
}

interface HotPathPlanBase {
  workerId: string;
  targetContractId: string;
  functionName: string;
  latencyBudget: LatencyBudget;
}

/**
 * A plan whose arguments are fixed at plan-creation time - not derived from
 * chain state observed later. This is the *only* shape that may be
 * pre-signed: signing commits to `args` before submission, so committing
 * early is only safe when nothing about `args` can still change.
 */
export interface StaticHotPathPlan<
  TArgs extends readonly unknown[] = readonly unknown[],
> extends HotPathPlanBase {
  kind: "static";
  args: TArgs;
}

/**
 * A plan whose arguments are built from observed chain state at submission
 * time (the same `ArgBuilder` contract as `WorkerDefinition.buildArgs`). Pre-
 * signing this is a signature over arguments that do not exist yet - never
 * safe, regardless of how the caller feels about the specific worker. There
 * is deliberately no field here that could be mistaken for a signed payload.
 */
export interface DynamicHotPathPlan<
  TArgs extends readonly unknown[] = readonly unknown[],
> extends HotPathPlanBase {
  kind: "dynamic";
  buildArgs: ArgBuilder<TArgs>;
}

/**
 * `isPreSignable` narrows on `kind`, so "is this plan safe to pre-sign" is a
 * type guard, not a judgment call made per plan - the distinction the
 * implementation notes ask for ("the code should make the distinction
 * structural").
 */
export type HotPathPlan<TArgs extends readonly unknown[] = readonly unknown[]> =
  StaticHotPathPlan<TArgs> | DynamicHotPathPlan<TArgs>;

/**
 * True only for `StaticHotPathPlan` - the sole shape whose arguments cannot
 * change between now and submission. `DynamicHotPathPlan` always returns
 * `false`, unconditionally: there is no configuration or override that makes
 * a state-dependent plan safe to pre-sign.
 */
export function isPreSignable<TArgs extends readonly unknown[]>(
  plan: HotPathPlan<TArgs>,
): plan is StaticHotPathPlan<TArgs> {
  return plan.kind === "static";
}

/**
 * How many warm standby processes must be able to take over immediately, so
 * a single process restart does not blow the latency budget (acceptance
 * criterion: "Hot standby so a single process restart does not blow the
 * latency budget"). What "warm" means operationally - keep-alive RPC
 * connections, pre-loaded simulation state - is defined by the real
 * implementation; this is the declared shape a config or scorecard reports
 * against.
 */
export interface HotStandbyConfig {
  /** Number of additional processes kept warm and ready to take over. */
  warmProcessCount: number;
}

/**
 * One measured submission, end to end: condition observed to transaction
 * submitted (acceptance criterion: "Latency budget measured end to end -
 * condition observed to transaction submitted - and published on the
 * scorecards"). `latencyMs` and `withinBudget` are derived - see
 * `recordScorecardEntry` - so a caller cannot construct an internally
 * inconsistent entry by hand.
 */
export interface LatencyScorecardEntry {
  workerId: string;
  conditionObservedAtMs: number;
  transactionSubmittedAtMs: number;
  latencyMs: number;
  ledgerBudget: number;
  withinBudget: boolean;
}

/**
 * Builds a `LatencyScorecardEntry` from raw observations, computing
 * `latencyMs` and `withinBudget` rather than trusting a caller to compute
 * them consistently. Does not publish anywhere - the real scorecard
 * destination (a dashboard, a metrics backend) does not exist yet; this is
 * the shape that destination will eventually receive.
 */
export function recordScorecardEntry(params: {
  workerId: string;
  conditionObservedAtMs: number;
  transactionSubmittedAtMs: number;
  latencyBudget: LatencyBudget;
  /** Milliseconds a single ledger close is assumed to take, for the budget check. */
  ledgerCloseMs: number;
}): LatencyScorecardEntry {
  const latencyMs = params.transactionSubmittedAtMs - params.conditionObservedAtMs;
  const ledgerBudget = params.latencyBudget.maxLedgers;
  const budgetMs = ledgerBudget * params.ledgerCloseMs;
  return {
    workerId: params.workerId,
    conditionObservedAtMs: params.conditionObservedAtMs,
    transactionSubmittedAtMs: params.transactionSubmittedAtMs,
    latencyMs,
    ledgerBudget,
    withinBudget: latencyMs <= budgetMs,
  };
}

/**
 * Thrown by `assertHotPathReady` - always, today. There is no submitter, no
 * pre-simulation, and no pre-signing infrastructure in this repo yet, and the
 * tier this path serves depends on #1064/#1070, both open. This function
 * exists so that whatever eventually wires a real hot path up has one place
 * to remove this gate, instead of the gate being implicit (or missing).
 */
export class HotPathNotImplementedError extends Error {
  constructor(reason: string) {
    super(`Hot-path execution is not implemented yet: ${reason}`);
    this.name = "HotPathNotImplementedError";
  }
}

/**
 * Always throws `HotPathNotImplementedError` in this stub - see the class
 * doc. Takes the tier's enable decision so the thrown message is specific
 * about *why* (unmeasured cost, missing dependencies) rather than generic,
 * and so a future real implementation has an obvious call site to start
 * from: replace this function's body once #1064, #1070, and a real
 * submitter exist.
 */
export function assertHotPathReady(decision: { enabled: boolean }): never {
  if (!decision.enabled) {
    throw new HotPathNotImplementedError(
      "the latency-sensitive tier is disabled (see backstop/tiers.ts's TierEnableDecision).",
    );
  }
  throw new HotPathNotImplementedError(
    "no submitter, pre-simulation, or pre-signing infrastructure exists yet; " +
      "#1064 (21.3) and #1070 (22.3) are also unimplemented.",
  );
}
