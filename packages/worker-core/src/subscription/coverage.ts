/**
 * Auditable coverage windows for backstop subscriptions (issue #1067, "21.6
 * Backstop subscription lifecycle and billing hooks").
 *
 * Acceptance criterion: *"Coverage boundaries are auditable: for any window, it
 * is answerable from stored records whether it was covered."* The emphasis is
 * on **stored**. The question has to stay answerable retroactively, for a
 * subscription that has since lapsed, without replaying an event log whose
 * replay could differ from what actually happened at the time.
 *
 * So the ledger is append-only and stores the *decision*, not the inputs to it:
 * {@link CoverageWindow.reason} is written down rather than derived, because
 * the policy that produced it may change later and the answer must not.
 *
 * Windows are half-open ledger intervals `[startLedger, endLedger)`. A ledger
 * belongs to exactly one window, so "was I covered at ledger N" is a lookup.
 *
 * See `docs/design/backstop-subscription-lifecycle.md`.
 */

/**
 * Why a window was, or was not, covered - recorded at the time the window
 * closed rather than re-derived at read time.
 */
export type CoverageReason = "active" | "grace" | "lapsed" | "cancelled";

/** The reasons that mean the subscriber was backstopped for the window. */
const COVERED_REASONS: ReadonlySet<CoverageReason> = new Set<CoverageReason>(["active", "grace"]);

/**
 * A closed, immutable statement about one stretch of ledgers: was this
 * subscription backstopped between `startLedger` (inclusive) and `endLedger`
 * (exclusive), and why.
 */
export type CoverageWindow = {
  subscriptionId: string;
  startLedger: number;
  endLedger: number;
  covered: boolean;
  /** Why, in the record itself. */
  reason: CoverageReason;
};

/**
 * The append-only store behind the audit. Records are never updated and never
 * deleted; a change in coverage is a new window, not an edit to an old one.
 *
 * The in-repo implementation is {@link InMemoryCoverageLedger}. Durable
 * adapters (Postgres, the operated service's own store) implement the same
 * interface - this is the MIT-side seam, per `docs/open-source-policy.md`.
 */
export interface CoverageLedger {
  /** Append one closed window. Throws {@link CoverageLedgerError} if it would corrupt the record. */
  append(window: CoverageWindow): Promise<void>;
  /** The window containing `ledger`, or `null` if no record covers that ledger. */
  findAt(subscriptionId: string, ledger: number): Promise<CoverageWindow | null>;
  /** Every stored window for a subscription, in ledger order. */
  history(subscriptionId: string): Promise<CoverageWindow[]>;
}

export type CoverageLedgerErrorCode =
  "LEDGER_OUT_OF_RANGE" | "EMPTY_WINDOW" | "OVERLAPPING_WINDOW" | "INCONSISTENT_REASON";

export class CoverageLedgerError extends Error {
  readonly code: CoverageLedgerErrorCode;

  constructor(code: CoverageLedgerErrorCode, message: string) {
    super(message);
    this.name = "CoverageLedgerError";
    this.code = code;
  }
}

function assertLedger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CoverageLedgerError(
      "LEDGER_OUT_OF_RANGE",
      `${label} must be a non-negative safe integer, got ${String(value)}`,
    );
  }
}

/**
 * Validates a window before it is written anywhere. Exported so a durable
 * adapter enforces the same invariants as the in-memory one rather than
 * inventing its own.
 */
export function assertValidCoverageWindow(window: CoverageWindow): void {
  assertLedger(window.startLedger, "startLedger");
  assertLedger(window.endLedger, "endLedger");

  if (window.endLedger <= window.startLedger) {
    throw new CoverageLedgerError(
      "EMPTY_WINDOW",
      `A coverage window must span at least one ledger, got [${window.startLedger}, ${window.endLedger})`,
    );
  }

  const shouldBeCovered = COVERED_REASONS.has(window.reason);
  if (window.covered !== shouldBeCovered) {
    throw new CoverageLedgerError(
      "INCONSISTENT_REASON",
      `reason "${window.reason}" cannot be recorded with covered=${String(window.covered)}`,
    );
  }
}

/** Whether a reason means the subscriber was backstopped. */
export function isCoveredReason(reason: CoverageReason): boolean {
  return COVERED_REASONS.has(reason);
}

/**
 * In-memory coverage ledger. Suitable for tests, single-process operation and
 * as the reference for what a durable adapter has to guarantee: appends only,
 * no overlaps, no record that contradicts its own reason.
 */
export class InMemoryCoverageLedger implements CoverageLedger {
  private readonly bySubscription = new Map<string, CoverageWindow[]>();

  async append(window: CoverageWindow): Promise<void> {
    assertValidCoverageWindow(window);

    const existing = this.bySubscription.get(window.subscriptionId) ?? [];
    for (const w of existing) {
      if (window.startLedger < w.endLedger && w.startLedger < window.endLedger) {
        throw new CoverageLedgerError(
          "OVERLAPPING_WINDOW",
          `[${window.startLedger}, ${window.endLedger}) overlaps the stored window ` +
            `[${w.startLedger}, ${w.endLedger}) for subscription ${window.subscriptionId}`,
        );
      }
    }

    existing.push({ ...window });
    existing.sort((a, b) => a.startLedger - b.startLedger);
    this.bySubscription.set(window.subscriptionId, existing);
  }

  async findAt(subscriptionId: string, ledger: number): Promise<CoverageWindow | null> {
    assertLedger(ledger, "ledger");
    const windows = this.bySubscription.get(subscriptionId) ?? [];
    const hit = windows.find((w) => ledger >= w.startLedger && ledger < w.endLedger);
    return hit ? { ...hit } : null;
  }

  async history(subscriptionId: string): Promise<CoverageWindow[]> {
    return (this.bySubscription.get(subscriptionId) ?? []).map((w) => ({ ...w }));
  }
}

/**
 * The audit answer for a single ledger: `true`/`false` from the record, or
 * `null` when no record covers that ledger.
 *
 * `null` is deliberately not `false`. "We have no record" and "we recorded that
 * you were not covered" are different answers in a dispute, and collapsing them
 * would let a gap in the ledger read as a denial.
 */
export async function wasCovered(
  ledger: CoverageLedger,
  subscriptionId: string,
  atLedger: number,
): Promise<boolean | null> {
  const window = await ledger.findAt(subscriptionId, atLedger);
  return window === null ? null : window.covered;
}

/**
 * The audit answer for a whole backstop window `[startLedger, endLedger)`:
 *
 * - `covered` - every stored record spanning the window says covered;
 * - `uncovered` - every stored record says not covered;
 * - `partial` - coverage changed inside the window (a lapse mid-window);
 * - `unknown` - some ledger in the window has no stored record at all.
 *
 * This is the shape the backstop watcher (21.1, #1062) reads at the top of each
 * window to decide whether to intervene, and the shape support reads when an
 * intervention is disputed.
 */
export async function coverageForWindow(
  ledger: CoverageLedger,
  subscriptionId: string,
  startLedger: number,
  endLedger: number,
): Promise<"covered" | "uncovered" | "partial" | "unknown"> {
  assertLedger(startLedger, "startLedger");
  assertLedger(endLedger, "endLedger");
  if (endLedger <= startLedger) {
    throw new CoverageLedgerError(
      "EMPTY_WINDOW",
      `A coverage window must span at least one ledger, got [${startLedger}, ${endLedger})`,
    );
  }

  const stored = await ledger.history(subscriptionId);
  const overlapping = stored.filter((w) => startLedger < w.endLedger && w.startLedger < endLedger);
  if (overlapping.length === 0) {
    return "unknown";
  }

  // Any ledger in the window not spanned by a record makes the answer unknown:
  // an unrecorded stretch must never be reported as covered.
  let cursor = startLedger;
  for (const w of overlapping) {
    if (w.startLedger > cursor) {
      return "unknown";
    }
    cursor = Math.max(cursor, w.endLedger);
  }
  if (cursor < endLedger) {
    return "unknown";
  }

  const covered = overlapping.filter((w) => w.covered).length;
  if (covered === overlapping.length) {
    return "covered";
  }
  if (covered === 0) {
    return "uncovered";
  }
  return "partial";
}
