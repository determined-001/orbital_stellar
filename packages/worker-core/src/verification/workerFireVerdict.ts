/**
 * The worker fire/miss verdict taxonomy (issue #1049, "19.1 Chain-derived
 * verification engine").
 *
 * Distinct from {@link ../verdict.js}'s `Verdict` type, which scores an
 * account/contract's overall on-chain activity for compliance/audit use
 * (issue 8.x) - a different concept that happens to share the word
 * "verdict". This module is about whether *one specific worker* honored
 * *one specific obligation window*: did the condition occur, and did the
 * declared invocation follow within the declared bound.
 */

export type WorkerFireVerdictStatus = "fired" | "missed" | "late" | "not-due";

/**
 * One obligation window: a condition occurrence and the deadline it created.
 * `windowId` is deterministic - derived from the worker and the condition
 * event's own identity (or, for a time trigger, the worker and the due
 * ledger) - so the same ledger range always names the same windows across
 * replays, which is what makes a stored verdict addressable and disputable.
 */
export type WorkerVerdictWindow = {
  readonly windowId: string;
  readonly workerId: string;
  /** Ledger the condition was observed at (event trigger) or was due at (time trigger). */
  readonly conditionLedger: number;
  /** Last ledger by which the invocation must land to count as on time. */
  readonly deadlineLedger: number;
};

export type WorkerFireVerdict = WorkerVerdictWindow & {
  readonly status: WorkerFireVerdictStatus;
  /** Set only for `status: "fired"` or `"late"` - the ledger the matching invocation actually landed at. */
  readonly invocationLedger?: number;
  /** Set only for `status: "fired"` or `"late"`, when the source event carried one. */
  readonly invocationTxHash?: string;
  /** Set only for `status: "late"` - `invocationLedger - deadlineLedger`. */
  readonly latencyLedgers?: number;
};
