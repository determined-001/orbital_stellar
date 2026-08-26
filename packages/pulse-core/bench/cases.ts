/**
 * The benchmark cases required by issue #924.
 *
 * Four things sit on the hot path and are gated here:
 *   1. raw event -> NormalizedEvent throughput   (normalizeContractEvent)
 *   2. decode-with-spec throughput               (decodeUnifiedTransfer)
 *   3. watcher fan-out at 1 / 100 / 1000         (Watcher.emit)
 *   4. cursor write cost per adapter             (CursorStore.set / setMany)
 *
 * Everything runs against the recorded CAP-67 corpus so the numbers reflect
 * pulse-core's own work, never network time. Cases are built by `buildCases()`
 * so fixtures are read once and shared across the whole run.
 */
import { normalizeContractEvent } from "../src/EventEngine.js";
import { decodeUnifiedTransfer } from "../src/cap67/decodeTransfer.js";
import { Watcher } from "../src/Watcher.js";
import { MemoryCursorStore } from "../src/MemoryCursorStore.js";
import type { NormalizedEvent } from "../src/index.js";
import type { BenchCase } from "./harness.js";
import { loadCap67Corpus, loadTransferFixtures, type RawSorobanFixtureEvent } from "./fixtures.js";

/** Fan-out widths mandated by the acceptance criteria. */
const FANOUT_WIDTHS = [1, 100, 1000] as const;

/** Batch size for the cursor setMany case, so the batch path is exercised, not a single write. */
const CURSOR_BATCH = 100;

/**
 * Shapes a recorded fixture event into the argument `normalizeContractEvent`
 * expects. The RPC record already carries the id, topic, and value fields, so
 * this only supplies `pagingToken` (absent from the fixtures) and passes the
 * rest through untouched.
 */
function toRpcEvent(event: RawSorobanFixtureEvent): Record<string, unknown> {
  return { ...event, pagingToken: event.id };
}

/** Builds every benchmark case. Fixtures are loaded once and closed over. */
export function buildCases(): BenchCase[] {
  const corpus = loadCap67Corpus();
  const transfers = loadTransferFixtures();
  const rpcEvents = corpus.map((f) => toRpcEvent(f.event));
  const transferInputs = transfers.map((f) => ({ topic: f.event.topic, value: f.event.value }));

  const cases: BenchCase[] = [];

  // 1. Raw event -> NormalizedEvent throughput. Cycles through the whole corpus
  //    so the mix of transfer/mint/burn/etc. is represented, not one shape.
  let normIdx = 0;
  cases.push({
    name: "normalize/raw-to-normalized",
    fn: () => {
      normalizeContractEvent(rpcEvents[normIdx++ % rpcEvents.length]!);
    },
  });

  // 2. Decode-with-spec throughput. Runs the CAP-67 transfer decoder over the
  //    transfer fixtures (bare i128 and SCMap-with-memo forms both included).
  let decIdx = 0;
  cases.push({
    name: "decode/cap67-transfer",
    fn: () => {
      decodeUnifiedTransfer(transferInputs[decIdx++ % transferInputs.length]!);
    },
  });

  // 3. Watcher fan-out at 1 / 100 / 1000 watchers. Each width is its own case so
  //    a regression localizes to a fan-out size. A no-op listener keeps the
  //    measurement on the emit/dispatch machinery, not user callback cost.
  const sample = normalizeContractEvent(rpcEvents[0]!) as NormalizedEvent;
  for (const width of FANOUT_WIDTHS) {
    let watchers: Watcher[] = [];
    cases.push({
      name: `watcher/fan-out-${width}`,
      setup: () => {
        watchers = Array.from({ length: width }, (_, i) => {
          const w = new Watcher(`bench-${i}`);
          w.on("*", () => {});
          return w;
        });
      },
      fn: () => {
        for (let i = 0; i < watchers.length; i++) watchers[i]!.emit("*", sample);
      },
    });
  }

  // 4. Cursor write cost per adapter. MemoryCursorStore is the in-process
  //    adapter; single-key set and the batch setMany are measured separately
  //    because a store that batches I/O is judged on the batch path. Other
  //    adapters (File/Postgres/Redis/S3) slot in here without touching a
  //    network; they are left out of the default run to keep it hermetic.
  //    The store methods are async but resolve synchronously for the in-memory
  //    map, so the async harness path awaits each write honestly.
  const memStore = new MemoryCursorStore();
  const batch: Record<string, string> = {};
  for (let i = 0; i < CURSOR_BATCH; i++) batch[`stream-${i}`] = `cursor-${i}`;
  let setIdx = 0;
  cases.push({
    name: "cursor/memory-set",
    async: true,
    fn: () => memStore.set(`stream-${setIdx % 1000}`, `cursor-${setIdx++}`),
  });
  cases.push({
    name: `cursor/memory-set-many-${CURSOR_BATCH}`,
    async: true,
    fn: () => memStore.setMany(batch),
  });

  return cases;
}
