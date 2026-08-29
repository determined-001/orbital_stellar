import type { ExportLedger, ExportReader, LedgerRange } from "../exports/types.js";
import type { VerificationEvent } from "./canonical.js";
import { fromExportLedger } from "./canonical.js";
import { computeVerdict, verdictCoreBytes, type Verdict } from "./verdict.js";
import type { CheckpointStore, VerdictSink } from "./stores.js";

/** Fixed window size in ledgers. Window boundaries are globally aligned so a
 * backfilled window and a live-computed window overlap exactly when their
 * ledger ranges overlap. */
export function windowStartFor(ledger: number, windowSize: number): number {
  return Math.floor(ledger / windowSize) * windowSize;
}

export type BackfillOptions = {
  reader: ExportReader;
  range: LedgerRange;
  /** Window length in ledgers. Defaults to 1000. */
  windowSize?: number;
  sink: VerdictSink;
  checkpoint: CheckpointStore;
  /** Subjects to score. Omit to score every address that appears in the export. */
  subjects?: string[];
  /** Called once per emitted verdict (for progress logging). */
  onVerdict?: (verdict: Verdict) => void;
};

export type BackfillResult = {
  ledgersRead: number;
  windowsEmitted: number;
  verdictsWritten: number;
  /** Where the data was read from, surfaced for the PR body / audit. */
  provenance: { kind: string; location: string };
  /** True when this run resumed from a checkpoint. */
  resumed: boolean;
};

/**
 * Verification backfill over a historical ledger range, read entirely from a
 * CDP / Galexie export via the shared {@link ExportReader}. It computes the
 * same {@link computeVerdict} the live verifier uses, marks each verdict
 * `source: "backfill"`, and checkpoints progress so a partial run can resume.
 *
 * Architectural constraints satisfied here:
 * - **No Orbital ledger store**: we read ledgers and discard them; only derived
 *   verdicts are written to the sink.
 * - **Reuses the #920 export reader**: `reader` is the one reader both
 *   consumers depend on.
 * - **Resumable & idempotent**: progress is checkpointed at window boundaries;
 *   a re-run or resume upserts by (subject, window), so output is stable.
 */
export class BackfillRunner {
  private readonly opts: BackfillOptions;
  private readonly windowSize: number;

  constructor(opts: BackfillOptions) {
    this.opts = opts;
    this.windowSize = opts.windowSize ?? 1000;
  }

  async run(): Promise<BackfillResult> {
    const { reader, range, sink, checkpoint, subjects, onVerdict } = this.opts;
    const prior = await checkpoint.load();
    const resumed = prior !== null;

    // Resume from the first ledger of the window that contains the last fully
    // flushed ledger (so a window split across the crash point is recomputed
    // whole, idempotently). Otherwise start at the requested range start.
    const effectiveStart =
      prior !== null
        ? windowStartFor(prior.lastProcessedLedger + 1, this.windowSize)
        : range.startLedger;
    const effectiveRange: LedgerRange = {
      startLedger: Math.max(effectiveStart, range.startLedger),
      endLedger: range.endLedger,
    };

    // windowKey -> subject -> events
    const buckets = new Map<string, Map<string, VerificationEvent[]>>();
    let ledgersRead = 0;
    let windowsEmitted = 0;
    let verdictsWritten = 0;
    let highestLedger = prior?.lastProcessedLedger ?? range.startLedger - 1;

    const flushWindow = async (windowStart: number, windowEnd: number): Promise<void> => {
      const bySubject = buckets.get(`${windowStart}-${windowEnd}`);
      if (!bySubject) return;
      for (const [subject, events] of bySubject) {
        if (subjects && !subjects.includes(subject)) continue;
        const verdict = computeVerdict(
          subject,
          { startLedger: windowStart, endLedger: windowEnd },
          events,
          { source: "backfill" },
        );
        await sink.upsert(verdict);
        verdictsWritten += 1;
        onVerdict?.(verdict);
      }
      buckets.delete(`${windowStart}-${windowEnd}`);
      windowsEmitted += 1;
      await checkpoint.save({
        lastProcessedLedger: windowEnd - 1,
        updatedAt: new Date().toISOString(),
      });
    };

    const subjectFilter = subjects ? new Set(subjects) : null;

    for await (const ledger of reader.read(effectiveRange)) {
      ledgersRead += 1;
      if (ledger.ledgerSequence > highestLedger) highestLedger = ledger.ledgerSequence;
      const events = fromExportLedger(ledger);
      for (const ev of events) {
        if (subjectFilter && !subjectFilter.has(ev.subject)) continue;
        const ws = windowStartFor(ev.ledger, this.windowSize);
        const we = ws + this.windowSize;
        const key = `${ws}-${we}`;
        let bySubject = buckets.get(key);
        if (!bySubject) {
          bySubject = new Map();
          buckets.set(key, bySubject);
        }
        const arr = bySubject.get(ev.subject) ?? [];
        arr.push(ev);
        bySubject.set(ev.subject, arr);
      }
      // Flush any windows that have been fully read (we are past their end).
      for (const key of [...buckets.keys()]) {
        const [wsStr, weStr] = key.split("-");
        const ws = Number(wsStr);
        const we = Number(weStr);
        if (ledger.ledgerSequence >= we) {
          await flushWindow(ws, we);
        }
      }
    }

    // Flush any trailing windows (their end exceeds the range, but all of
    // their in-range ledgers have been read).
    for (const key of [...buckets.keys()]) {
      const [wsStr, weStr] = key.split("-");
      await flushWindow(Number(wsStr), Number(weStr));
    }

    return {
      ledgersRead,
      windowsEmitted,
      verdictsWritten,
      provenance: reader.provenance(),
      resumed,
    };
  }
}

// Re-export so the live path and tooling can share one import surface.
export { verdictCoreBytes };
export type { ExportLedger };
