import { EventEngine } from "../src/EventEngine.js";

type EngineBenchInternals = {
  normalize: (record: unknown) => unknown;
  route: (event: unknown) => void;
};

type BenchmarkResult = {
  subscriptions: number;
  responses: number;
  eventsPerResponse: number;
  rpcEvents: number;
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

type SyntheticRpcEvent = {
  type: "contract_event";
  id: string;
  pagingToken: string;
  contract_id: string;
  topics: string[];
  data: Record<string, string>;
  created_at: string;
};

type SyntheticGetEventsResponse = {
  cursor: string;
  events: SyntheticRpcEvent[];
};

const SUBSCRIPTION_COUNTS = [1000, 5000, 10000] as const;
const DEFAULT_RESPONSE_COUNT = 10;
const DEFAULT_EVENTS_PER_RESPONSE = 100;

function toMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function forceGc(): void {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function makeContractId(index: number): string {
  // Contract IDs are routing keys in this benchmark; keep the shape deterministic.
  return `C${String(index).padStart(55, "0")}`;
}

function makeSyntheticGetEventsResponse(
  responseIndex: number,
  eventsPerResponse: number,
  subscriptionCount: number
): SyntheticGetEventsResponse {
  const events: SyntheticRpcEvent[] = [];
  const baseIndex = responseIndex * eventsPerResponse;

  for (let i = 0; i < eventsPerResponse; i += 1) {
    const eventIndex = baseIndex + i;
    const contractIndex = eventIndex % subscriptionCount;
    const pagingToken = String(eventIndex + 1).padStart(12, "0");

    events.push({
      type: "contract_event",
      id: `evt-${pagingToken}`,
      pagingToken,
      contract_id: makeContractId(contractIndex),
      topics: ["transfer", `account-${contractIndex}`],
      data: { amount: "1.0000000" },
      created_at: "2026-01-01T00:00:00.000Z",
    });
  }

  return {
    cursor: events.at(-1)?.pagingToken ?? String(baseIndex).padStart(12, "0"),
    events,
  };
}

function subscribeContractWatchers(engine: EventEngine, subscriptionCount: number): void {
  for (let i = 0; i < subscriptionCount; i += 1) {
    const watcher = engine.subscribeContract(`contract-sub-${i}`, {
      filters: [{ contractIds: [makeContractId(i)] }],
    });
    watcher.on("*", () => {
      // Intentionally empty: includes EventEmitter dispatch cost in throughput figures.
    });
  }
}

function runScenario(
  subscriptionCount: number,
  responseCount: number,
  eventsPerResponse: number
): BenchmarkResult {
  forceGc();
  const baselineHeapMb = toMb(process.memoryUsage().heapUsed);

  const engine = new EventEngine({ network: "testnet" });
  const internals = engine as unknown as EngineBenchInternals;

  subscribeContractWatchers(engine, subscriptionCount);
  forceGc();
  const subscribedHeapMb = toMb(process.memoryUsage().heapUsed);

  const start = process.hrtime.bigint();

  for (let responseIndex = 0; responseIndex < responseCount; responseIndex += 1) {
    const response = makeSyntheticGetEventsResponse(responseIndex, eventsPerResponse, subscriptionCount);

    for (const rpcEvent of response.events) {
      const normalized = internals.normalize(rpcEvent);
      if (!normalized) {
        continue;
      }

      internals.route(normalized);
    }
  }

  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

  forceGc();
  const postReplayMemory = process.memoryUsage();

  engine.stop();

  // Each matching contract subscription receives the typed event and '*'.
  const rpcEvents = responseCount * eventsPerResponse;
  const routedEvents = rpcEvents * 2;
  const eventsPerSecond = Number((routedEvents / (durationMs / 1000)).toFixed(2));

  return {
    subscriptions: subscriptionCount,
    responses: responseCount,
    eventsPerResponse,
    rpcEvents,
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

function getPositiveIntegerArg(name: string, defaultValue: number): number {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return defaultValue;

  const rawValue = arg.split("=")[1];
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name} value: ${rawValue}`);
  }

  return parsed;
}

function main(): void {
  const responses = getPositiveIntegerArg("responses", DEFAULT_RESPONSE_COUNT);
  const eventsPerResponse = getPositiveIntegerArg("events-per-response", DEFAULT_EVENTS_PER_RESPONSE);

  console.log("pulse-core Soroban throughput benchmark");
  console.log(`node=${process.version}`);
  console.log(`responses_per_scenario=${responses}`);
  console.log(`events_per_response=${eventsPerResponse}`);
  if (typeof global.gc !== "function") {
    console.log("gc=unavailable (run with --expose-gc for tighter memory numbers)");
  }
  console.log("");

  const results = SUBSCRIPTION_COUNTS.map((subscriptions) =>
    runScenario(subscriptions, responses, eventsPerResponse)
  );

  console.table(
    results.map((result) => ({
      subscriptions: result.subscriptions,
      responses: result.responses,
      rpc_events: result.rpcEvents,
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
