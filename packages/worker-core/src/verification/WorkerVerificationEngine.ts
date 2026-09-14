/**
 * Chain-derived worker verification (issue #1049, "19.1").
 *
 * The structural claim: because Orbital already decodes and normalizes the
 * same events a worker's trigger condition and invocation are built from, it
 * can verify - from that same chain data - whether a worker fired when it
 * should have, rather than trusting the worker's self-reported logs.
 *
 * Two properties are load-bearing, same as `triggers/eventTrigger.ts`'s:
 *
 *   **Determinism.** `verify()` is a pure function of its arguments. No
 *   clock, no network, no ambient state - the same events and the same
 *   range always produce the same verdicts. That is what a replay test
 *   proves and what makes a stored verdict disputable without a support
 *   conversation.
 *
 *   **No operator input.** Verification never reads anything the operator
 *   supplied beyond the worker definition itself (and, for an event
 *   trigger, the separately-registered `EventTriggerDefinition` that
 *   declares the latency bound) - only events this engine's caller already
 *   obtained through `EventEngine`. There is no "trust me, it fired" path.
 *
 * Plugs into `EventEngine`'s existing normalized-event stream rather than
 * opening a second ingestion path: callers pass the same `NormalizedEvent`s
 * `EventEngine` produces (backfilled or live), this module never fetches
 * anything itself.
 */
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import type { WorkerDefinition, Schedule as ManifestSchedule } from "../types.js";
import type { EventTriggerPlanner } from "../triggers/eventTrigger.js";
import { dueTimesBetween } from "../schedule.js";
import type { Schedule as SchedulerSchedule } from "../schedule.js";
import type { WorkerFireVerdict, WorkerFireVerdictStatus } from "./workerFireVerdict.js";

/**
 * `types.ts`'s `Schedule` (the manifest-facing shape `WorkerDefinition.trigger`
 * carries - `kind`-discriminated, always timezone-aware) and `schedule.ts`'s
 * `Schedule` (what `dueTimesBetween`/`TriggerEvaluator` actually operate on -
 * `type`-discriminated, timezone optional) are two separate types that predate
 * this module and were never reconciled. Bridging them here rather than
 * changing either: `types.ts`'s shape is the public manifest contract,
 * `schedule.ts`'s is the scheduler engine's internal one, and picking a side
 * is a larger change than this issue's scope.
 */
function toSchedulerSchedule(schedule: ManifestSchedule): SchedulerSchedule {
  return schedule.kind === "interval"
    ? { type: "interval", intervalMs: schedule.everyMs }
    : { type: "cron", expression: schedule.expression, timezone: schedule.timezone };
}

/**
 * Maps ledgers to close times and back. A real deployment builds this from
 * the same ledger-header data a backfill scan over the range already reads -
 * it is not a second RPC client, just an index over data the caller already
 * has for the range it is asking about.
 */
export interface LedgerCloseTimeIndex {
  /** The close time of `ledger`, or `undefined` if it falls outside this index's known range. */
  closeTimeOfLedger(ledger: number): Date | undefined;
  /** The first ledger whose close time is `>= at`, or `undefined` if none is known within range. */
  firstLedgerAtOrAfter(at: Date): number | undefined;
}

/** A `LedgerCloseTimeIndex` over an explicit, sorted `(ledger, closeTime)` list - fine for a bounded replay range. */
export class ArrayLedgerCloseTimeIndex implements LedgerCloseTimeIndex {
  private readonly sorted: ReadonlyArray<{ ledger: number; closeTime: Date }>;

  constructor(entries: ReadonlyArray<{ ledger: number; closeTime: Date }>) {
    this.sorted = [...entries].sort((a, b) => a.ledger - b.ledger);
  }

  closeTimeOfLedger(ledger: number): Date | undefined {
    return this.sorted.find((e) => e.ledger === ledger)?.closeTime;
  }

  firstLedgerAtOrAfter(at: Date): number | undefined {
    return this.sorted.find((e) => e.closeTime.getTime() >= at.getTime())?.ledger;
  }
}

/**
 * Thrown by `verify()` for a `WorkerDefinition` whose trigger kind has no
 * window-derivation source yet. Mirrors `TriggerNotImplementedError`'s
 * "present as a type, rejected at runtime" pattern in `types.ts`.
 *
 * Computation-trigger windows ship with issue #1061 (20.7), which owns
 * `computationTrigger.ts` - adding a second, narrower window source here
 * ahead of that design would be exactly the "second ingestion/planning
 * path" this module's own doc comment says not to build.
 */
export class TriggerVerificationNotImplementedError extends Error {
  readonly kind: "computation";
  constructor() {
    super(
      'Verification for "computation" triggers ships with issue #1061 (20.7) - ' +
        "an off-chain condition needs an attestation model before it can be verified " +
        "from chain data at all, which is that issue's design question to answer.",
    );
    this.name = "TriggerVerificationNotImplementedError";
    this.kind = "computation";
  }
}

function isSuccessfulInvocationOf(
  event: NormalizedEvent,
  contractId: string,
  functionName: string,
): event is Extract<NormalizedEvent, { type: "contract.invoked" }> {
  return (
    event.type === "contract.invoked" &&
    event.contractId === contractId &&
    event.function === functionName &&
    event.inSuccessfulContractCall !== false
  );
}

/** Ledger of any normalized event that carries one - `undefined` otherwise. */
function ledgerOf(event: NormalizedEvent): number | undefined {
  const ledger = (event as { ledger?: number }).ledger;
  return typeof ledger === "number" && Number.isFinite(ledger) ? ledger : undefined;
}

/**
 * Resolves one window's verdict against `events` and `toLedger` (the last
 * ledger this verification run has actually observed - not necessarily
 * "now"). Shared by both trigger kinds once a window's `conditionLedger`/
 * `deadlineLedger` are known, which is the only thing that differs between them.
 */
function resolveWindow(
  window: { windowId: string; workerId: string; conditionLedger: number; deadlineLedger: number },
  targetContractId: string,
  functionName: string,
  events: ReadonlyArray<NormalizedEvent>,
  toLedger: number,
): WorkerFireVerdict {
  let best: { ledger: number; txHash?: string } | undefined;
  for (const event of events) {
    if (!isSuccessfulInvocationOf(event, targetContractId, functionName)) continue;
    const ledger = ledgerOf(event);
    if (ledger === undefined || ledger < window.conditionLedger) continue;
    if (best === undefined || ledger < best.ledger) {
      best = { ledger, txHash: event.txHash };
    }
  }

  if (best !== undefined) {
    const status: WorkerFireVerdictStatus = best.ledger <= window.deadlineLedger ? "fired" : "late";
    return {
      ...window,
      status,
      invocationLedger: best.ledger,
      invocationTxHash: best.txHash,
      ...(status === "late" ? { latencyLedgers: best.ledger - window.deadlineLedger } : {}),
    };
  }

  // No matching invocation observed anywhere in the queried range. Whether
  // that means "missed" or merely "not checked yet" depends on whether the
  // deadline itself falls within what this run actually looked at.
  const status: WorkerFireVerdictStatus = toLedger < window.deadlineLedger ? "not-due" : "missed";
  return { ...window, status };
}

export class WorkerVerificationEngine {
  /**
   * Verifies a time-triggered worker over `[fromLedger, toLedger]`.
   *
   * `TimeTrigger` (see `types.ts`) does not yet carry a declared latency
   * bound the way `EventTriggerDefinition` does - `latencyBoundLedgers`
   * must be supplied here until a future manifest change closes that gap,
   * mirroring the exact gap `triggers/eventTrigger.ts` already flags for
   * its own definition type.
   */
  verifyTimeTrigger(
    definition: WorkerDefinition,
    events: ReadonlyArray<NormalizedEvent>,
    range: { fromLedger: number; toLedger: number },
    options: { latencyBoundLedgers: number; ledgerCloseTimes: LedgerCloseTimeIndex },
  ): WorkerFireVerdict[] {
    if (definition.trigger.kind !== "time") {
      throw new Error(`verifyTimeTrigger called with a "${definition.trigger.kind}" trigger`);
    }
    const fromClose = options.ledgerCloseTimes.closeTimeOfLedger(range.fromLedger);
    const toClose = options.ledgerCloseTimes.closeTimeOfLedger(range.toLedger);
    if (!fromClose || !toClose) {
      throw new Error(
        "verifyTimeTrigger: ledgerCloseTimes does not cover the requested range's endpoints",
      );
    }

    const dueTimes = dueTimesBetween(
      toSchedulerSchedule(definition.trigger.schedule),
      fromClose,
      toClose,
    );
    const verdicts: WorkerFireVerdict[] = [];
    for (const due of dueTimes) {
      const conditionLedger = options.ledgerCloseTimes.firstLedgerAtOrAfter(due);
      // A due time past the index's known range can't be resolved to a
      // ledger - skipped rather than guessed. The caller's `toLedger` bounds
      // what can honestly be asked about; a due time beyond it is not this
      // run's business.
      if (conditionLedger === undefined || conditionLedger > range.toLedger) continue;

      const window = {
        windowId: `${definition.id}:t:${conditionLedger}`,
        workerId: definition.id,
        conditionLedger,
        deadlineLedger: conditionLedger + options.latencyBoundLedgers,
      };
      verdicts.push(
        resolveWindow(
          window,
          definition.targetContractId,
          definition.functionName,
          events,
          range.toLedger,
        ),
      );
    }
    return verdicts;
  }

  /**
   * Verifies an event-triggered worker over the windows `planner` derives
   * from `conditionEvents`. Reuses `EventTriggerPlanner.plan()` rather than
   * re-deriving windows - planning and verification stay two different
   * questions asked of the same deterministic function, per that module's
   * own design note.
   */
  verifyEventTrigger(
    definition: WorkerDefinition,
    planner: EventTriggerPlanner,
    conditionEvents: ReadonlyArray<NormalizedEvent>,
    invocationEvents: ReadonlyArray<NormalizedEvent>,
    toLedger: number,
  ): WorkerFireVerdict[] {
    if (definition.trigger.kind !== "event") {
      throw new Error(`verifyEventTrigger called with a "${definition.trigger.kind}" trigger`);
    }
    const { decisions } = planner.plan(conditionEvents);
    return decisions.map((decision) =>
      resolveWindow(
        decision,
        definition.targetContractId,
        definition.functionName,
        invocationEvents,
        toLedger,
      ),
    );
  }

  /**
   * Verifies a computation-triggered worker. Always throws - see
   * {@link TriggerVerificationNotImplementedError}.
   */
  verifyComputationTrigger(definition: WorkerDefinition): never {
    if (definition.trigger.kind !== "computation") {
      throw new Error(
        `verifyComputationTrigger called with a "${definition.trigger.kind}" trigger`,
      );
    }
    throw new TriggerVerificationNotImplementedError();
  }
}
