/**
 * The per-window outcome vocabulary shared by verification (19.1) and the
 * backstop (21.1).
 *
 * The taxonomy itself — what each outcome means, why there are six rather than
 * four, and which failure mode each one exists to prevent — is
 * `docs/design/worker-verification-verdicts.md`. This module is only the types,
 * declared because two components need to agree on them: a backstop that
 * decided "missed" using its own private notion of missed would intervene on
 * windows verification later scores differently, and the divergence would show
 * up as unexplained interventions rather than as a type error.
 *
 * NAMING: this lives here rather than in `../verification/verdict.ts`, and the
 * six-value union is `WindowOutcome` rather than `Verdict`, because
 * `verification/verdict.ts` already exports a `Verdict` — the chain-derived
 * verification *record* (schema version, ledger window, metrics, source) built
 * by the backfill engine in #1054. The two are different things at different
 * altitudes: that one is the evidence, this one is the ruling on a single
 * window. Sharing the name would have made the collision a merge conflict
 * rather than a design decision.
 */

/**
 * The six verdicts. See the design note for the reasoning; in brief:
 *
 * - `not-due` — nothing was owed. The default; `missed` requires positively
 *   establishing an obligation, not merely observing silence.
 * - `fired` — the invocation landed within the declared bound.
 * - `late` — it landed after the bound, with a measured latency.
 * - `missed` — the bound passed with no invocation.
 * - `unverifiable` — the window cannot be reconstructed from chain data.
 *   Excluded from reputation, and never counted as a success.
 * - `pending` — the bound has not elapsed yet. The only verdict that may
 *   transition, and it does so exactly once.
 */
export type WindowOutcome = "not-due" | "fired" | "late" | "missed" | "unverifiable" | "pending";

/** Why a window resolved to `not-due` or `unverifiable`. */
export type WindowOutcomeReason =
  | "rejected-early-call"
  | "precondition-satisfied"
  | "before-activation"
  | "condition-recurred-in-window"
  | "missing-ledger"
  | "decode-unavailable"
  | "spec-not-ledger-versioned"
  | "no-attestation"
  | "attestation-invalid";

/**
 * A scored window.
 *
 * Carries its own evidence, because the point of chain-derived verification is
 * that an operator can dispute a verdict without a support conversation — and a
 * `missed` with no evidence pointer is an assertion, not a finding.
 */
export type WindowVerdict = {
  readonly windowId: string;
  readonly workerId: string;
  readonly verdict: WindowOutcome;
  readonly conditionLedger: number;
  readonly deadlineLedger: number;
  /** Set on `fired` and `late`. */
  readonly firedLedger?: number;
  /** Set on `late`. Measured in ledgers, not seconds — see the design note §2.1. */
  readonly latencyLedgers?: number;
  /** Set on `not-due` and `unverifiable`. */
  readonly reason?: WindowOutcomeReason;
};

/** Verdicts that mean the worker demonstrably did not do what was owed. */
export function isFailure(verdict: WindowOutcome): boolean {
  return verdict === "missed";
}

/**
 * Verdicts excluded from reputation scoring.
 *
 * `unverifiable` is excluded rather than counted either way, and `pending` is
 * not yet scoreable. The design note is emphatic that exclusion must be paired
 * with disclosure: a worker whose windows are mostly excluded has a score with
 * a visible asterisk, or exclusion becomes a way to launder a bad record.
 */
export function isExcludedFromScoring(verdict: WindowOutcome): boolean {
  return verdict === "unverifiable" || verdict === "pending";
}

/**
 * The verdict source the backstop reads.
 *
 * 19.1 owns the implementation. Stated as an interface so 21.1 can be built and
 * tested against it, and so the backstop consumes verdicts rather than deriving
 * a second opinion about the same window.
 */
export interface WindowVerdictSource {
  /**
   * The verdict for `windowId` as of `atLedger`, or `undefined` when the
   * window is unknown to verification.
   */
  verdictFor(
    windowId: string,
    atLedger: number,
  ): Promise<WindowVerdict | undefined> | (WindowVerdict | undefined);
}
