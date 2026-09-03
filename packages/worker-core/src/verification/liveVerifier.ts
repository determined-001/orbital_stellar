import type { VerificationEvent } from "./canonical.js";
import { computeVerdict, type Verdict } from "./verdict.js";
import { windowStartFor } from "./backfill.js";

/**
 * The live verification path. In production this is fed by the EventEngine
 * subscription: each normalized event is reduced to a {@link VerificationEvent}
 * (carrying its ledger, which the live RPC envelope provides) and handed here.
 *
 * Critically, it calls the **same** {@link computeVerdict} as
 * {@link BackfillRunner}. That single shared function - fed identical,
 * canonicalized events - is the reason a backfilled verdict is byte-identical
 * to a live-computed one for any overlapping range.
 */
export class LiveVerifier {
  private readonly windowSize: number;
  private readonly buckets = new Map<string, Map<string, VerificationEvent[]>>();

  constructor(windowSize = 1000) {
    this.windowSize = windowSize;
  }

  ingest(event: VerificationEvent): void {
    const ws = windowStartFor(event.ledger, this.windowSize);
    const we = ws + this.windowSize;
    const key = `${ws}-${we}`;
    let bySubject = this.buckets.get(key);
    if (!bySubject) {
      bySubject = new Map();
      this.buckets.set(key, bySubject);
    }
    const arr = bySubject.get(event.subject) ?? [];
    arr.push(event);
    bySubject.set(event.subject, arr);
  }

  ingestAll(events: VerificationEvent[]): void {
    for (const e of events) this.ingest(e);
  }

  /** Compute verdicts for all buffered windows (source = `"live"`). */
  flush(): Verdict[] {
    const out: Verdict[] = [];
    for (const key of [...this.buckets.keys()]) {
      const [wsStr, weStr] = key.split("-");
      const ws = Number(wsStr);
      const we = Number(weStr);
      const bySubject = this.buckets.get(key);
      if (!bySubject) continue;
      for (const [subject, events] of bySubject) {
        out.push(
          computeVerdict(subject, { startLedger: ws, endLedger: we }, events, { source: "live" }),
        );
      }
      this.buckets.delete(key);
    }
    return out;
  }
}
