/**
 * The worker fire/miss verdict taxonomy (issue #1049, "19.1 Chain-derived
 * verification engine"), per the design note at
 * `docs/design/worker-verification-verdicts.md`.
 *
 * Distinct from {@link ../verdict.js}'s `Verdict` type, which scores an
 * account/contract's overall on-chain activity for compliance/audit use
 * (issue 8.x) - a different concept that happens to share the word
 * "verdict". This module is about whether *one specific worker* honored
 * *one specific obligation window*: did the condition occur, and did the
 * declared invocation follow within the declared bound.
 *
 * Six statuses, not the issue's literal four - the design note works
 * through why two more are structurally required to stop the four from
 * lying (see its §2):
 *
 * - `pending` exists so a verdict is never computed, and then possibly
 *   recomputed differently, while the outcome could still change. Without
 *   it, a window whose deadline has not yet passed has to be called either
 *   `not-due` (which then has to un-say itself later - not an immutable
 *   verdict at all) or omitted (making "no verdict yet" ambiguous with "not
 *   evaluated"). `pending` is the only status that may transition, and it
 *   transitions exactly once, to one of the other five, once the window's
 *   deadline is behind the verification horizon (see
 *   `WorkerVerificationEngine`'s `verificationHorizonLedgers`).
 * - `unverifiable` is for a window that cannot be reconstructed from chain
 *   data at all - required by issue #1061 (an off-chain condition has no
 *   chain evidence without an attestation) and, separately, by cases where
 *   chain data itself is insufficient (a condition event with no `ledger`).
 *   Excluded from reputation scoring entirely - never counted as a success.
 */

export type WorkerFireVerdictStatus =
  "pending" | "not-due" | "fired" | "late" | "missed" | "unverifiable";

/**
 * Why a `not-due` or `unverifiable` verdict was reached. Not decoration - an
 * operator disputing a verdict needs to know *which* rule fired, not just
 * the status.
 */
export type WorkerVerdictReason =
  // not-due
  | "rejected-early-call"
  | "before-activation"
  | "window-already-open"
  // unverifiable
  | "missing-ledger"
  | "no-attestation"
  | "attestation-invalid"
  | "attestation-window-mismatch"
  | "attestation-unretrievable";

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
  /** Set for `status: "not-due"` or `"unverifiable"` - which rule produced it. */
  readonly reason?: WorkerVerdictReason;
  /** Set only for `status: "fired"` or `"late"` - the ledger the matching invocation actually landed at. */
  readonly invocationLedger?: number;
  /** Set only for `status: "fired"` or `"late"`, when the source event carried one. */
  readonly invocationTxHash?: string;
  /** Set only for `status: "late"` - `invocationLedger - deadlineLedger`. */
  readonly latencyLedgers?: number;
};

/**
 * `unverifiable` (and, transiently, `pending`) must never be counted as a
 * success when folding verdicts into a reputation score - the scoring fold
 * itself is W1's downstream concern (see the design note §8), but this
 * exclusion is the one rule from this taxonomy every fold must honor.
 */
export const EXCLUDED_FROM_SCORING: ReadonlySet<WorkerFireVerdictStatus> = new Set([
  "pending",
  "unverifiable",
]);
