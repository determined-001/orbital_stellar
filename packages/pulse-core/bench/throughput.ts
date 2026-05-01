import { EventEngine } from "../src/index.js";

type EngineBenchInternals = EventEngine & {
  normalize: (record: unknown) => unknown;
  route: (event: unknown) => void;
};

type BenchmarkResult = {
  watchers: number;
  records: number;
  routedEvents: number;
  durationMs: number;
  eventsPerSecond: number;
  memory: {
    baselineHeapMb: number;
    subscribedHeapMb: number;
    postReplayHeapMb: number;
    postReplayRssMb: number;
  };
};

const WATCHER_COUNTS = [1000, 5000, 10000] as const;
const DEFAULT_RECORD_COUNT = 100_000;

function toMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function forceGc(): void {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function makeAddress(index: number): string {
  // Routing keys are string lookups; this deterministic shape keeps the benchmark stable.
  return `G${String(index).padStart(55, "0")}`;
}

function makeSyntheticPaymentRecord(index: number, watcherCount: number): Record<string, unknown> {
  const toIndex = index % watcherCount;
  const fromIndex = (index + 1) % watcherCount;

  return {
    type: "payment",
    to: makeAddress(toIndex),
    from: makeAddress(fromIndex),
    amount: "1.0000000",
    asset_type: "native",
    created_at: "2026-01-01T00:00:00.000Z",
    id: `${index}`,
  };
}

function subscribeWatchers(engine: EventEngine, watcherCount: number): void {
  for (let i = 0; i < watcherCount; i += 1) {
    const watcher = engine.subscribe(makeAddress(i));
    watcher.on("*", () => {
      // Intentionally empty: includes EventEmitter dispatch cost in throughput figures.
    });
  }
}

function runScenario(watcherCount: number, recordCount: number): BenchmarkResult {
  forceGc();
  const baselineHeapMb = toMb(process.memoryUsage().heapUsed);

  const engine = new EventEngine({ network: "testnet" });
  const internals = engine as EngineBenchInternals;

  subscribeWatchers(engine, watcherCount);
  forceGc();
  const subscribedHeapMb = toMb(process.memoryUsage().heapUsed);

  const start = process.hrtime.bigint();

  for (let i = 0; i < recordCount; i += 1) {
    const normalized = internals.normalize(makeSyntheticPaymentRecord(i, watcherCount));
    if (!normalized) {
      continue;
    }

    internals.route(normalized);
  }

  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

  forceGc();
  const postReplayMemory = process.memoryUsage();

  engine.stop();

  // Each payment routes to both "to" and "from" watcher; each watcher gets the typed event and '*'.
  const routedEvents = recordCount * 4;
  const eventsPerSecond = Number((routedEvents / (durationMs / 1000)).toFixed(2));

  return {
    watchers: watcherCount,
    records: recordCount,
    routedEvents,
    durationMs: Number(durationMs.toFixed(2)),
    eventsPerSecond,
    memory: {
      baselineHeapMb,
      subscribedHeapMb,
      postReplayHeapMb: toMb(postReplayMemory.heapUsed),
      postReplayRssMb: toMb(postReplayMemory.rss),
    },
  };
}

function getRecordCountFromArgs(): number {
  const arg = process.argv.find((value) => value.startsWith("--records="));
  if (!arg) return DEFAULT_RECORD_COUNT;

  const rawValue = arg.split("=")[1];
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --records value: ${rawValue}`);
  }

  return parsed;
}

function main(): void {
  const records = getRecordCountFromArgs();

  console.log("pulse-core throughput benchmark");
  console.log(`node=${process.version}`);
  console.log(`records_per_scenario=${records}`);
  if (typeof global.gc !== "function") {
    console.log("gc=unavailable (run with --expose-gc for tighter memory numbers)");
  }
  console.log("");

  const results = WATCHER_COUNTS.map((watchers) => runScenario(watchers, records));

  console.table(
    results.map((result) => ({
      watchers: result.watchers,
      records: result.records,
      routed_events: result.routedEvents,
      duration_ms: result.durationMs,
      events_per_sec: result.eventsPerSecond,
      baseline_heap_mb: result.memory.baselineHeapMb,
      subscribed_heap_mb: result.memory.subscribedHeapMb,
      post_replay_heap_mb: result.memory.postReplayHeapMb,
      post_replay_rss_mb: result.memory.postReplayRssMb,
    }))
  );

  console.log("\nJSON results:");
  console.log(JSON.stringify(results, null, 2));
}

main();
