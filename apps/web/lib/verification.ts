import {
  computeVerdict,
  InMemoryVerdictSink,
  VERDICT_SCHEMA_VERSION,
  type Verdict,
  type VerdictSink,
  type VerificationEvent,
} from "@orbital-stellar/worker-core";

/**
 * Chain-derived verification verdicts for the public read API (19.4).
 *
 * Mirrors the store pattern in `@/lib/registry` and `@/lib/workers` (a
 * `globalThis` singleton so the demo server keeps one in-memory copy). This
 * is demo data, seeded deterministically on first access: the live/backfill
 * verifier (19.1/19.2) is not wired into this deployment, so there is no real
 * `VerificationEvent` stream to compute verdicts from yet. Once it is, this
 * module's `getVerdictSink()` is the same `VerdictSink` a real verifier would
 * upsert into - only `seedVerdicts` goes away.
 */

const g = globalThis as unknown as { __orbitalVerdictSink?: VerdictSink };

export function getVerdictSink(): VerdictSink {
  if (!g.__orbitalVerdictSink) {
    const sink = new InMemoryVerdictSink();
    void seedVerdicts(sink);
    g.__orbitalVerdictSink = sink;
  }
  return g.__orbitalVerdictSink;
}

function events(subject: string, entries: Array<Partial<VerificationEvent>>): VerificationEvent[] {
  return entries.map((e) => ({
    ledger: 0,
    closeTime: new Date().toISOString(),
    kind: "payment_received",
    subject,
    counterparty: null,
    asset: "XLM",
    amount: "0",
    authorized: null,
    txHash: null,
    ...e,
  }));
}

async function seedVerdicts(sink: VerdictSink): Promise<void> {
  const now = Date.now();
  const day = 86_400_000;
  const ledgersPerDay = 17_280; // ~5s close time
  const nowLedger = 60_000_000;

  const windows: {
    subject: string;
    startLedger: number;
    endLedger: number;
    events: VerificationEvent[];
  }[] = [
    {
      subject: "GSETTLEMENTDESKALPHA0000000000000000000000000000000000",
      startLedger: nowLedger - ledgersPerDay,
      endLedger: nowLedger,
      events: events("GSETTLEMENTDESKALPHA0000000000000000000000000000000000", [
        { ledger: nowLedger - ledgersPerDay + 100, kind: "payment_sent", amount: "1200.5000000" },
        { ledger: nowLedger - ledgersPerDay + 4000, kind: "payment_received", amount: "800.0000000" },
        { ledger: nowLedger - 500, kind: "payment_sent", amount: "50.2500000" },
      ]),
    },
    {
      subject: "GSETTLEMENTDESKALPHA0000000000000000000000000000000000",
      startLedger: nowLedger - 2 * ledgersPerDay,
      endLedger: nowLedger - ledgersPerDay,
      events: events("GSETTLEMENTDESKALPHA0000000000000000000000000000000000", [
        { ledger: nowLedger - 2 * ledgersPerDay + 200, kind: "payment_sent", amount: "300.0000000" },
      ]),
    },
    {
      subject: "GMERIDIANPAY000000000000000000000000000000000000000000",
      startLedger: nowLedger - ledgersPerDay,
      endLedger: nowLedger,
      events: events("GMERIDIANPAY000000000000000000000000000000000000000000", [
        { ledger: nowLedger - ledgersPerDay + 50, kind: "payment_received", amount: "45.0000000" },
        { ledger: nowLedger - ledgersPerDay + 60, kind: "set_authorized", authorized: true },
      ]),
    },
  ];

  for (const w of windows) {
    const verdict: Verdict = computeVerdict(
      w.subject,
      { startLedger: w.startLedger, endLedger: w.endLedger },
      w.events,
      { source: "backfill", computedAt: new Date(now - day).toISOString() },
    );
    await sink.upsert(verdict);
  }
}

export { VERDICT_SCHEMA_VERSION };
