import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};
type MockStreamInstance = { handlers: StreamHandlers; close: ReturnType<typeof vi.fn> };

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    operations() {
      return {
        cursor() {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ handlers, close });
              return close;
            },
          };
        },
      };
    }
  }
  return { Horizon: { Server: MockServer } };
});

import { EventEngine } from "../src/EventEngine.js";
import type { ContractSubscriptionConfig } from "../src/index.js";

function configRegistry(engine: EventEngine): Map<string, unknown> {
  return (engine as unknown as { contractConfigRegistry: Map<string, unknown> })
    .contractConfigRegistry;
}

beforeEach(() => {
  streamInstances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsubscribeContract(config)", () => {
  it("stops the watcher matching the config and removes its registry entry", () => {
    const engine = new EventEngine({ network: "testnet" });
    const config: ContractSubscriptionConfig = { filters: [{ contractIds: ["CA1234"] }] };
    const watcher = engine.subscribeContract(config);
    expect(configRegistry(engine).size).toBe(1);

    engine.unsubscribeContract(config);

    expect(watcher.stopped).toBe(true);
    expect(configRegistry(engine).size).toBe(0);
    // A fresh subscribe returns a new watcher — the old key is gone.
    const next = engine.subscribeContract({ filters: [{ contractIds: ["CA1234"] }] });
    expect(next).not.toBe(watcher);
  });

  it("matches the subscription regardless of contractIds order", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribeContract({ filters: [{ contractIds: ["CA", "CB"] }] });

    engine.unsubscribeContract({ filters: [{ contractIds: ["CB", "CA"] }] });

    expect(watcher.stopped).toBe(true);
    expect(configRegistry(engine).size).toBe(0);
  });

  it("removes only the matching config and leaves the others intact", () => {
    const engine = new EventEngine({ network: "testnet" });
    const a = engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });
    const b = engine.subscribeContract({ filters: [{ contractIds: ["CB"] }] });

    engine.unsubscribeContract({ filters: [{ contractIds: ["CA"] }] });

    expect(a.stopped).toBe(true);
    expect(b.stopped).toBe(false);
    expect(configRegistry(engine).size).toBe(1);
  });

  it("is a no-op for a config that was never subscribed", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });

    expect(() => engine.unsubscribeContract({ filters: [{ contractIds: ["CZ"] }] })).not.toThrow();
    expect(configRegistry(engine).size).toBe(1);
  });

  it("still supports the legacy id-based overload", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribeContract("CAAA");
    engine.unsubscribeContract("CAAA");
    expect(engine.status().contractWatcherCount).toBe(0);
  });
});

describe("unsubscribeAllContracts() — config-based subscriptions", () => {
  it("stops config-based watchers and leaves the Horizon stream running", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC"); // classic Horizon subscription
    const c1 = engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });
    const c2 = engine.subscribeContract({ filters: [{ contractIds: ["CB"] }] });
    engine.subscribeContract("CLEGACY"); // legacy id-based contract sub
    engine.start();

    engine.unsubscribeAllContracts();

    expect(c1.stopped).toBe(true);
    expect(c2.stopped).toBe(true);
    expect(configRegistry(engine).size).toBe(0);
    expect(engine.status().contractWatcherCount).toBe(0); // legacy gone too

    // Done when: the Horizon stream keeps running and classic subs are untouched.
    expect(engine.status().running).toBe(true);
    expect(engine.status().watcherCount).toBe(1);
    expect(streamInstances).toHaveLength(1);
  });

  it("emits engine.stopped to config-based watchers before stopping them", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });
    const stopped = vi.fn();
    watcher.on("engine.stopped", stopped);

    engine.unsubscribeAllContracts();

    expect(stopped).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith(
      expect.objectContaining({ type: "engine.stopped", attempt: 0 }),
    );
    expect(watcher.stopped).toBe(true);
  });
});
