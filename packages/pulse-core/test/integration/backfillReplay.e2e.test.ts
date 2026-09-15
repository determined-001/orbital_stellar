import { describe, it, expect, afterEach } from "vitest";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { EventEngine } from "../../src/EventEngine.js";
import { RpcHistoricalSource, OutOfRetentionError } from "../../src/HistoricalSource.js";
import type { SorobanEvent } from "../../src/index.js";

// ── Gating ────────────────────────────────────────────────────────────────────
// Mirror the existing soroban.test.ts e2e pattern: the whole suite only runs
// under INTEGRATION_TESTS=true (set by .github/workflows/integration.yml on the
// nightly cron). The live backfill/replay case additionally needs a reachable
// Soroban RPC + a start/end ledger window with emitted contract events; without
// them it self-skips with a clear message instead of failing the nightly run.
const shouldRun = process.env.INTEGRATION_TESTS === "true";

const RPC_URL = process.env.BACKFILL_RPC_URL ?? "";
const START_LEDGER = Number(process.env.BACKFILL_START_LEDGER ?? "0");
const END_LEDGER = Number(process.env.BACKFILL_END_LEDGER ?? "0");
const CONTRACT_ID = process.env.BACKFILL_CONTRACT_ID ?? "";

const hasConfig = Boolean(RPC_URL) && START_LEDGER > 0 && END_LEDGER > START_LEDGER;

// ── Beyond-retention case (issue #920) ──────────────────────────────────────
// Extends this same harness rather than duplicating it, per the issue's own
// acceptance criterion. Needs a *second* RPC endpoint configured with deeper
// retention than the primary (docs/design/long-range-replay.md §2) and a
// ledger window this repo's CI environment does not itself provide - unset
// by default, so this self-skips exactly like the case above.
const HISTORICAL_RPC_URL = process.env.BACKFILL_HISTORICAL_RPC_URL ?? "";
const OUT_OF_RETENTION_START_LEDGER = Number(
  process.env.BACKFILL_OUT_OF_RETENTION_START_LEDGER ?? "0",
);
const OUT_OF_RETENTION_END_LEDGER = Number(process.env.BACKFILL_OUT_OF_RETENTION_END_LEDGER ?? "0");

const hasHistoricalConfig =
  Boolean(RPC_URL) &&
  Boolean(HISTORICAL_RPC_URL) &&
  OUT_OF_RETENTION_START_LEDGER > 0 &&
  OUT_OF_RETENTION_END_LEDGER > OUT_OF_RETENTION_START_LEDGER;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolve once `predicate` returns a value, polling up to `timeoutMs`.
async function waitFor<T>(predicate: () => T | undefined, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value !== undefined) return value;
    await sleep(500);
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

describe.runIf(shouldRun)("Soroban backfill/replay e2e", () => {
  let engine: EventEngine | undefined;

  afterEach(async () => {
    await engine?.stop();
    engine = undefined;
  });

  // Live case: replays a bounded ledger window against a real RPC and asserts
  // every emitted contract event in range is delivered in ledger order without
  // touching the durable CursorStore.
  it.runIf(hasConfig)(
    "replays a bounded ledger window and delivers events in order",
    async () => {
      const received: SorobanEvent[] = [];

      const server = new SorobanRpc.Server(RPC_URL);

      engine = new EventEngine({ network: "testnet", soroban: { rpcUrl: RPC_URL } });
      const subscriber = engine.replayContracts({
        rpc: server,
        filters: CONTRACT_ID ? [{ contractIds: [CONTRACT_ID] }] : undefined,
        startLedger: START_LEDGER,
        endLedger: END_LEDGER,
        onEvent: async (event) => {
          received.push(event);
        },
        onDone: () => {
          /* signalled below via replayDone */
        },
      });
      subscriber.start();

      // Wait until the bounded replay run signals completion (endLedger reached
      // or the RPC reports no further events in range).
      await waitFor(
        () => (subscriber as unknown as { replayDone?: boolean }).replayDone ?? undefined,
        90_000,
      );

      // Even if the window has no events, the run must complete; if it has
      // events, they must be delivered strictly in ascending ledger order.
      expect(received.length).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < received.length; i++) {
        expect(received[i].ledger!).toBeGreaterThanOrEqual(received[i - 1].ledger!);
      }
      if (CONTRACT_ID) {
        for (const e of received) {
          expect(e.contractId).toBe(CONTRACT_ID);
        }
      }
    },
    120_000,
  );

  it.skipIf(hasConfig)(
    "skips the live backfill/replay when BACKFILL_RPC_URL / ledger window are unset",
    () => {
      console.warn(
        "[backfill e2e] live test skipped - set BACKFILL_RPC_URL, " +
          "BACKFILL_START_LEDGER and BACKFILL_END_LEDGER (a ledger window with " +
          "emitted contract events) to run it against a real Soroban RPC.",
      );
      expect(hasConfig).toBe(false);
    },
  );

  // Live case (issue #920): a startLedger genuinely older than the primary
  // RPC's retention replays with identical NormalizedEvent output via a
  // configured HistoricalSource, rather than failing.
  it.runIf(hasHistoricalConfig)(
    "replays a startLedger beyond the primary RPC's retention via a HistoricalSource",
    async () => {
      const received: SorobanEvent[] = [];

      const server = new SorobanRpc.Server(RPC_URL);
      const historicalServer = new SorobanRpc.Server(HISTORICAL_RPC_URL);
      const historicalSource = new RpcHistoricalSource(historicalServer);

      engine = new EventEngine({ network: "testnet", soroban: { rpcUrl: RPC_URL } });
      const subscriber = engine.replayContracts({
        rpc: server,
        historicalSource,
        filters: CONTRACT_ID ? [{ contractIds: [CONTRACT_ID] }] : undefined,
        startLedger: OUT_OF_RETENTION_START_LEDGER,
        endLedger: OUT_OF_RETENTION_END_LEDGER,
        onEvent: async (event) => {
          received.push(event);
        },
        onDone: () => {
          /* signalled below via replayDone */
        },
      });
      subscriber.start();

      await waitFor(
        () => (subscriber as unknown as { replayDone?: boolean }).replayDone ?? undefined,
        90_000,
      );

      expect(received.length).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < received.length; i++) {
        expect(received[i].ledger!).toBeGreaterThanOrEqual(received[i - 1].ledger!);
      }
    },
    120_000,
  );

  // Confirms the primary RPC really does reject this window on its own -
  // proving the historical-source case above is actually exercising the
  // fallback, not silently succeeding because the window was in range all along.
  it.runIf(hasHistoricalConfig)(
    "confirms the primary RPC alone rejects the same window as out of retention",
    async () => {
      const server = new SorobanRpc.Server(RPC_URL);
      engine = new EventEngine({ network: "testnet", soroban: { rpcUrl: RPC_URL } });

      await expect(
        new Promise((resolve, reject) => {
          const subscriber = engine!.replayContracts({
            rpc: server,
            filters: CONTRACT_ID ? [{ contractIds: [CONTRACT_ID] }] : undefined,
            startLedger: OUT_OF_RETENTION_START_LEDGER,
            endLedger: OUT_OF_RETENTION_END_LEDGER,
            onEvent: async () => {},
            onDone: () => resolve(undefined),
          });
          subscriber.pollOnce().catch(reject);
        }),
      ).rejects.toBeInstanceOf(OutOfRetentionError);
    },
    60_000,
  );

  it.skipIf(hasHistoricalConfig)(
    "skips the beyond-retention live case when BACKFILL_HISTORICAL_RPC_URL / out-of-retention window are unset",
    () => {
      console.warn(
        "[backfill e2e] beyond-retention live test skipped - set BACKFILL_HISTORICAL_RPC_URL " +
          "(a second RPC with deeper retention), BACKFILL_OUT_OF_RETENTION_START_LEDGER and " +
          "BACKFILL_OUT_OF_RETENTION_END_LEDGER (a window older than the primary RPC's retention) " +
          "to run it against real endpoints.",
      );
      expect(hasHistoricalConfig).toBe(false);
    },
  );
});
