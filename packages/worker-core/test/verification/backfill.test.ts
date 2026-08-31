import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackfillRunner,
  ExportReader,
  FileExportSource,
  FileVerdictSink,
  FileCheckpointStore,
  InMemoryVerdictSink,
  InMemoryCheckpointStore,
  LiveVerifier,
  MemoryExportSource,
  computeVerdict,
  fromLiveLedger,
  verdictCoreBytes,
  type Verdict,
} from "../../src/index.js";
import type { ExportLedger, LiveLedger } from "../../src/index.js";

const WINDOW = 50;

/** Build the same logical ledger twice: once in "export" shape, once in "live" shape,
 * with deliberately different raw formatting (asset "XLM" vs "native", "10.0000000" vs "10.0")
 * so the byte-identical test proves canonicalization, not shared objects. */
function buildLedgers(
  start: number,
  end: number,
): { exportLedgers: ExportLedger[]; liveLedgers: LiveLedger[] } {
  const exportLedgers: ExportLedger[] = [];
  const liveLedgers: LiveLedger[] = [];
  for (let ledger = start; ledger < end; ledger += 1) {
    const closeTime = `2024-01-${(ledger % 28) + 1}T00:00:00Z`;
    exportLedgers.push({
      ledgerSequence: ledger,
      closeTime,
      network: "testnet",
      transactions: [
        {
          transactionId: `tx-${ledger}`,
          operations: [
            { kind: "payment", from: "GAAA", to: "GBBB", amount: "10.0000000", asset: "XLM" },
            { kind: "mint", to: "GCCC", amount: "5.0000000", asset: "USDC:GISSUER" },
            { kind: "burn", from: "GCCC", amount: "2.0000000", asset: "USDC:GISSUER" },
            { kind: "fee", from: "GAAA", amount: "0.0000100", asset: "XLM" },
            { kind: "set_authorized", trustor: "GBBB", asset: "USDC:GISSUER", authorized: true },
          ],
        },
      ],
    });
    liveLedgers.push({
      ledger,
      closeTime,
      transactions: [
        {
          transactionId: `tx-${ledger}`,
          operations: [
            { kind: "payment", from: "GAAA", to: "GBBB", amount: "10.0", asset: "native" },
            { kind: "mint", to: "GCCC", amount: "5", asset: "USDC:GISSUER" },
            { kind: "burn", from: "GCCC", amount: "2.0", asset: "USDC:GISSUER" },
            { kind: "fee", from: "GAAA", amount: "0.00001", asset: "XLM" },
            { kind: "set_authorized", trustor: "GBBB", asset: "USDC:GISSUER", authorized: true },
          ],
        },
      ],
    });
  }
  return { exportLedgers, liveLedgers };
}

function coreSet(verdicts: Verdict[]): Set<string> {
  return new Set(verdicts.map(verdictCoreBytes));
}

describe("verification backfill", () => {
  it("computes backfilled verdicts marked as source=backfill without an RPC dependency", async () => {
    const { exportLedgers } = buildLedgers(100, 250);
    const sink = new InMemoryVerdictSink();
    const checkpoint = new InMemoryCheckpointStore();
    const reader = new ExportReader(new MemoryExportSource(exportLedgers));
    const result = await new BackfillRunner({
      reader,
      range: { startLedger: 100, endLedger: 250 },
      windowSize: WINDOW,
      sink,
      checkpoint,
    }).run();

    expect(result.ledgersRead).toBe(150);
    expect(result.provenance.kind).toBe("file");
    const verdicts = await sink.all();
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) {
      expect(v.source).toBe("backfill");
      expect(v.schemaVersion).toBe(1);
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("produces byte-identical verdict cores to the live path over overlapping ranges", async () => {
    const { exportLedgers, liveLedgers } = buildLedgers(100, 250);

    // Backfill path.
    const sink = new InMemoryVerdictSink();
    const reader = new ExportReader(new MemoryExportSource(exportLedgers));
    await new BackfillRunner({
      reader,
      range: { startLedger: 100, endLedger: 250 },
      windowSize: WINDOW,
      sink,
      checkpoint: new InMemoryCheckpointStore(),
    }).run();
    const backfillVerdicts = await sink.all();

    // Live path (same logical ledgers, different raw formatting).
    const live = new LiveVerifier(WINDOW);
    live.ingestAll(liveLedgers.flatMap(fromLiveLedger));
    const liveVerdicts = live.flush();

    // Same subjects/windows must yield identical cores, despite different source markers.
    expect(liveVerdicts.map((v) => v.source)).not.toContain("backfill");
    const backfillByKey = new Map(
      backfillVerdicts.map((v) => [`${v.subject}|${v.window.startLedger}`, v]),
    );
    for (const lv of liveVerdicts) {
      const bv = backfillByKey.get(`${lv.subject}|${lv.window.startLedger}`);
      expect(
        bv,
        `missing backfill verdict for ${lv.subject}@${lv.window.startLedger}`,
      ).toBeDefined();
      // The decisive test: identical core bytes.
      expect(verdictCoreBytes(lv)).toBe(verdictCoreBytes(bv!));
      // But the source marker distinguishes them.
      expect(lv.source).toBe("live");
      expect(bv!.source).toBe("backfill");
    }
  });

  it("is idempotent: the same range yields identical verdicts on a fresh run", async () => {
    const { exportLedgers } = buildLedgers(100, 250);
    const reader = new ExportReader(new MemoryExportSource(exportLedgers));
    const range = { startLedger: 100, endLedger: 250 } as const;

    const sinkA = new InMemoryVerdictSink();
    const first = await new BackfillRunner({
      reader,
      range,
      windowSize: WINDOW,
      sink: sinkA,
      checkpoint: new InMemoryCheckpointStore(),
    }).run();

    const sinkB = new InMemoryVerdictSink();
    const second = await new BackfillRunner({
      reader,
      range,
      windowSize: WINDOW,
      sink: sinkB,
      checkpoint: new InMemoryCheckpointStore(),
    }).run();

    expect(first.verdictsWritten).toBe(second.verdictsWritten);
    expect(coreSet(await sinkA.all())).toEqual(coreSet(await sinkB.all()));
  });

  it("is resumable: resuming from a mid-range checkpoint yields the same final verdicts", async () => {
    const { exportLedgers } = buildLedgers(100, 250);

    // Baseline: full run from scratch.
    const baselineSink = new InMemoryVerdictSink();
    await new BackfillRunner({
      reader: new ExportReader(new MemoryExportSource(exportLedgers)),
      range: { startLedger: 100, endLedger: 250 },
      windowSize: WINDOW,
      sink: baselineSink,
      checkpoint: new InMemoryCheckpointStore(),
    }).run();
    const baseline = coreSet(await baselineSink.all());

    // Resumed run: pretend we crashed after ledger 130 (inside the first window).
    const resumeSink = new InMemoryVerdictSink();
    const resumeCheckpoint = new InMemoryCheckpointStore();
    await resumeCheckpoint.save({ lastProcessedLedger: 130, updatedAt: new Date().toISOString() });
    const result = await new BackfillRunner({
      reader: new ExportReader(new MemoryExportSource(exportLedgers)),
      range: { startLedger: 100, endLedger: 250 },
      windowSize: WINDOW,
      sink: resumeSink,
      checkpoint: resumeCheckpoint,
    }).run();

    expect(result.resumed).toBe(true);
    const resumed = coreSet(await resumeSink.all());
    // Final verdicts are identical to the full run. At most one extra window was recomputed.
    expect(resumed).toEqual(baseline);
  });

  it("reads from a real Galexie JSONL file and writes verdict files (no ledger stored)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-backfill-"));
    const outDir = join(dir, "verdicts");
    try {
      const { exportLedgers } = buildLedgers(100, 150);
      // Write genuine Galexie "ledger" transform JSON (field names the parser expects).
      const lines = exportLedgers.map((l) =>
        JSON.stringify({
          ledger_sequence: l.ledgerSequence,
          close_time: l.closeTime,
          network: l.network,
          transactions: l.transactions.map((tx) => ({
            transaction_id: tx.transactionId,
            operations: tx.operations.map((op) => {
              switch (op.kind) {
                case "payment":
                  return {
                    type: "payment",
                    source_account: op.from,
                    destination: op.to,
                    amount: op.amount,
                    asset: { asset_type: "native" },
                  };
                case "mint":
                  return {
                    type: "mint",
                    destination: op.to,
                    amount: op.amount,
                    asset: {
                      asset_type: "credit_alphanum4",
                      asset_code: "USDC",
                      asset_issuer: "GISSUER",
                    },
                  };
                case "burn":
                  return {
                    type: "burn",
                    source_account: op.from,
                    amount: op.amount,
                    asset: {
                      asset_type: "credit_alphanum4",
                      asset_code: "USDC",
                      asset_issuer: "GISSUER",
                    },
                  };
                case "clawback":
                  return {
                    type: "clawback",
                    source_account: op.from,
                    amount: op.amount,
                    asset: {
                      asset_type: "credit_alphanum4",
                      asset_code: "USDC",
                      asset_issuer: "GISSUER",
                    },
                  };
                case "fee":
                  return { type: "fee", source_account: op.from, amount: op.amount };
                case "set_authorized":
                  return {
                    type: "set_authorized",
                    trustor: op.trustor,
                    asset: {
                      asset_type: "credit_alphanum4",
                      asset_code: "USDC",
                      asset_issuer: "GISSUER",
                    },
                    authorized: op.authorized,
                  };
                default:
                  return null;
              }
            }),
          })),
        }),
      );
      await writeFile(join(dir, "ledgers.jsonl"), lines.join("\n"), "utf8");

      const source = new FileExportSource({ directory: dir, format: "galexie" });
      const reader = new ExportReader(source);
      const sink = new FileVerdictSink(outDir);
      const result = await new BackfillRunner({
        reader,
        range: { startLedger: 100, endLedger: 150 },
        windowSize: WINDOW,
        sink,
        checkpoint: new FileCheckpointStore(dir),
      }).run();

      expect(result.provenance.kind).toBe("galexie");
      const verdicts = await sink.all();
      expect(verdicts.length).toBeGreaterThan(0);
      for (const v of verdicts) expect(v.source).toBe("backfill");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("computeVerdict is deterministic and order-independent across sources", () => {
    const a = computeVerdict("GAAA", { startLedger: 100, endLedger: 150 }, [
      {
        ledger: 101,
        closeTime: "2024-01-01T00:00:00Z",
        kind: "payment_sent",
        subject: "gaaa",
        counterparty: "gbbb",
        asset: "XLM",
        amount: "10.0",
        authorized: null,
        txHash: "t1",
      },
    ]);
    const b = computeVerdict("gaaa", { startLedger: 100, endLedger: 150 }, [
      {
        ledger: 101,
        closeTime: "2024-01-01T00:00:00Z",
        kind: "payment_sent",
        subject: "GAAA",
        counterparty: "GBBB",
        asset: "native",
        amount: "10.0000000",
        authorized: null,
        txHash: "t1",
      },
    ]);
    expect(verdictCoreBytes(a)).toBe(verdictCoreBytes(b));
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

afterEach(() => {
  // no global teardown needed; temp dirs are removed inline
});
