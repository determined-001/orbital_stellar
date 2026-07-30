import { beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  url: string;
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    constructor(private readonly url: string) {}
    operations() {
      const url = this.url;
      return {
        cursor() {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ url, handlers, close });
              return close;
            },
          };
        },
      };
    }
  }

  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

import { EventEngine } from "../src/EventEngine.js";
import type { NormalizedEvent } from "../src/index.js";

const TESTNET_URL = "https://horizon-testnet.stellar.org";
const MAINNET_URL = "https://horizon.stellar.org";

function paymentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "payment",
    to: "GDEST",
    from: "GSRC",
    amount: "10.0000000",
    asset_type: "native",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function findStream(url: string): MockStreamInstance {
  const stream = streamInstances.find((s) => s.url === url);
  if (!stream) throw new Error(`No mock stream opened for ${url}`);
  return stream;
}

beforeEach(() => {
  streamInstances.length = 0;
});

describe("EventEngine - multi-network", () => {
  it("constructs one independent sub-engine per network source", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    engine.start();

    expect(streamInstances).toHaveLength(2);
    expect(streamInstances.map((s) => s.url).sort()).toEqual([MAINNET_URL, TESTNET_URL].sort());
  });

  it("rejects an empty network source array", () => {
    expect(() => new EventEngine({ network: [] })).toThrow(
      "at least one network source is required",
    );
  });

  it("rejects duplicate network sources", () => {
    expect(
      () =>
        new EventEngine({
          network: [{ network: "testnet" }, { network: "testnet" }],
        }),
    ).toThrow('duplicate network source "testnet"');
  });

  it("delivers events from both networks to one subscribe() watcher, tagged with their network", async () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    const watcher = engine.subscribe("GDEST");
    const received: NormalizedEvent[] = [];
    watcher.on("payment.received", (e) => received.push(e));

    engine.start();

    findStream(TESTNET_URL).handlers.onmessage(paymentRecord({ amount: "1.0000000" }));
    findStream(MAINNET_URL).handlers.onmessage(paymentRecord({ amount: "2.0000000" }));

    expect(received).toHaveLength(2);
    const byNetwork = Object.fromEntries(received.map((e) => [e.network, e]));
    expect(byNetwork.testnet).toMatchObject({ amount: "1.0000000", network: "testnet" });
    expect(byNetwork.mainnet).toMatchObject({ amount: "2.0000000", network: "mainnet" });
  });

  it("also delivers tagged events on the wildcard listener", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    const watcher = engine.subscribe("GDEST");
    const received: NormalizedEvent[] = [];
    watcher.on("*", (e) => received.push(e as NormalizedEvent));

    engine.start();
    findStream(TESTNET_URL).handlers.onmessage(paymentRecord());

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ network: "testnet" });
  });

  it("subscribe() is idempotent by address, same as single-network mode", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });

    const first = engine.subscribe("GDEST");
    const second = engine.subscribe("GDEST");

    expect(first).toBe(second);
  });

  it("passes the filter option through to each sub-engine", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    const watcher = engine.subscribe("GDEST", {
      filter: (e) => (e as { amount?: string }).amount === "5.0000000",
    });
    const received: NormalizedEvent[] = [];
    watcher.on("payment.received", (e) => received.push(e));

    engine.start();
    findStream(TESTNET_URL).handlers.onmessage(paymentRecord({ amount: "1.0000000" }));
    findStream(TESTNET_URL).handlers.onmessage(paymentRecord({ amount: "5.0000000" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ amount: "5.0000000" });
  });

  it("stops sub-watchers and removes the parent watcher on unsubscribe", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    const watcher = engine.subscribe("GDEST");
    const received: NormalizedEvent[] = [];
    watcher.on("payment.received", (e) => received.push(e));

    engine.start();
    engine.unsubscribe("GDEST");

    findStream(TESTNET_URL).handlers.onmessage(paymentRecord());

    expect(received).toHaveLength(0);
    expect(engine.status().watcherCount).toBe(0);
  });

  it("status() reports both an aggregate and a per-network breakdown", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    engine.subscribe("GDEST");
    engine.start();

    findStream(TESTNET_URL).handlers.onmessage(paymentRecord());

    const status = engine.status();
    expect(status.running).toBe(true);
    expect(status.watcherCount).toBe(1);
    expect(status.networks?.testnet?.horizon.running).toBe(true);
    expect(status.networks?.testnet?.horizon.lastEventAt).not.toBeNull();
    expect(status.networks?.mainnet?.horizon.running).toBe(true);
    expect(status.networks?.mainnet?.horizon.lastEventAt).toBeNull();
    // Aggregate reflects the union across networks.
    expect(status.sources.horizon.running).toBe(true);
    expect(status.sources.horizon.lastEventAt).not.toBeNull();
  });

  it("start() opens every network's stream and returns true", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });

    const started = engine.start();

    expect(started).toBe(true);
    expect(streamInstances).toHaveLength(2);
  });

  it("stop() closes every network's stream and stops parent watchers", async () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    const watcher = engine.subscribe("GDEST");
    const stopped = vi.fn();
    watcher.on("engine.stopped", stopped);

    engine.start();
    await engine.stop();

    expect(findStream(TESTNET_URL).close).toHaveBeenCalledTimes(1);
    expect(findStream(MAINNET_URL).close).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(watcher.stopped).toBe(true);
  });

  it("healthCheck() prefixes each sub-engine's reasons with its network", async () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    // Neither sub-engine has been started, so both report unhealthy.
    const result = await engine.healthCheck();

    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.startsWith("testnet: horizon source"))).toBe(true);
    expect(result.reasons.some((r) => r.startsWith("mainnet: horizon source"))).toBe(true);
  });

  it("pauseSource()/resumeSource() fan out to every sub-engine", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    engine.subscribe("GDEST");
    engine.start();

    engine.pauseSource("horizon");
    const status = engine.status();
    expect(status.pausedSources).toEqual(["horizon"]);
    expect(status.networks?.testnet).toBeDefined();

    engine.resumeSource("horizon");
    expect(engine.status().pausedSources).toBeUndefined();
  });

  it("subscribeContract(id) fans out to every sub-engine and dedupes by id", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });

    const first = engine.subscribeContract("sub1");
    const second = engine.subscribeContract("sub1");

    expect(first).toBe(second);
    expect(engine.status().contractWatcherCount).toBe(1);
  });

  it("subscribeContract(config) fans out to every sub-engine and dedupes by filter shape", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });

    const config = { filters: [{ contractIds: ["CAAA"] }] };
    const first = engine.subscribeContract(config);
    const second = engine.subscribeContract({ filters: [{ contractIds: ["CAAA"] }] });

    expect(first).toBe(second);
  });
});
