import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

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

  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

import { EventEngine } from "../src/EventEngine.js";

beforeEach(() => {
  streamInstances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// unsubscribeAll — Horizon registry
// ---------------------------------------------------------------------------

describe("unsubscribeAll()", () => {
  it("empties the Horizon registry but keeps the SSE stream open", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC");
    engine.subscribe("GDEF");
    engine.start();

    const registry = (engine as unknown as { registry: Map<string, unknown> })
      .registry;
    expect(registry.size).toBe(2);

    engine.unsubscribeAll();

    expect(registry.size).toBe(0);
    expect(engine.status().running).toBe(true);
    expect(streamInstances).toHaveLength(1);
  });

  it("does not touch the contractRegistry", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC");
    engine.subscribeContract("CAAA");
    engine.start();

    engine.unsubscribeAll();

    const contractRegistry = (
      engine as unknown as { contractRegistry: Map<string, unknown> }
    ).contractRegistry;
    expect(contractRegistry.size).toBe(1);
    expect(engine.status().watcherCount).toBe(0);
    expect(engine.status().contractWatcherCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// unsubscribeAllContracts() — Soroban / contract registry
// ---------------------------------------------------------------------------

describe("unsubscribeAllContracts()", () => {
  it("empties the contract registry without closing the Horizon stream", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribeContract("CAAA");
    engine.subscribeContract("CBBB");
    engine.start();

    expect(engine.status().contractWatcherCount).toBe(2);

    engine.unsubscribeAllContracts();

    expect(engine.status().contractWatcherCount).toBe(0);
    // Horizon stream must remain open
    expect(engine.status().running).toBe(true);
    expect(streamInstances).toHaveLength(1);
  });

  it("emits engine.stopped to every contract watcher before stopping it", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcherA = engine.subscribeContract("CAAA");
    const watcherB = engine.subscribeContract("CBBB");
    const stoppedA = vi.fn();
    const stoppedB = vi.fn();
    watcherA.on("engine.stopped", stoppedA);
    watcherB.on("engine.stopped", stoppedB);

    engine.start();
    engine.unsubscribeAllContracts();

    expect(stoppedA).toHaveBeenCalledOnce();
    expect(stoppedA).toHaveBeenCalledWith(
      expect.objectContaining({ type: "engine.stopped", attempt: 0 })
    );
    expect(stoppedB).toHaveBeenCalledOnce();
    expect(stoppedB).toHaveBeenCalledWith(
      expect.objectContaining({ type: "engine.stopped", attempt: 0 })
    );
  });

  it("marks every contract watcher as stopped after the call", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribeContract("CAAA");

    engine.unsubscribeAllContracts();

    expect(watcher.stopped).toBe(true);
  });

  it("does not touch the Horizon watcher registry", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC");
    engine.subscribeContract("CAAA");
    engine.start();

    engine.unsubscribeAllContracts();

    const registry = (engine as unknown as { registry: Map<string, unknown> })
      .registry;
    expect(registry.size).toBe(1);
    expect(engine.status().watcherCount).toBe(1);
  });

  it("is idempotent — calling twice does not throw", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribeContract("CAAA");
    engine.start();

    engine.unsubscribeAllContracts();
    expect(() => engine.unsubscribeAllContracts()).not.toThrow();
    expect(engine.status().contractWatcherCount).toBe(0);
  });

  it("is a no-op when the contract registry is already empty", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();

    expect(() => engine.unsubscribeAllContracts()).not.toThrow();
    expect(engine.status().contractWatcherCount).toBe(0);
    expect(engine.status().running).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// subscribeContract / unsubscribeContract — baseline sanity
// ---------------------------------------------------------------------------

describe("subscribeContract() / unsubscribeContract()", () => {
  it("returns the same watcher for repeated subscribeContract calls", () => {
    const engine = new EventEngine({ network: "testnet" });
    const first = engine.subscribeContract("CAAA");
    const second = engine.subscribeContract("CAAA");

    expect(first).toBe(second);
    expect(engine.status().contractWatcherCount).toBe(1);
  });

  it("unsubscribeContract removes a single watcher and leaves others intact", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribeContract("CAAA");
    engine.subscribeContract("CBBB");

    engine.unsubscribeContract("CAAA");

    expect(engine.status().contractWatcherCount).toBe(1);
    const contractRegistry = (
      engine as unknown as { contractRegistry: Map<string, unknown> }
    ).contractRegistry;
    expect(contractRegistry.has("CAAA")).toBe(false);
    expect(contractRegistry.has("CBBB")).toBe(true);
  });

  it("unsubscribeContract is a no-op for an unknown contractId", () => {
    const engine = new EventEngine({ network: "testnet" });
    expect(() => engine.unsubscribeContract("CNONE")).not.toThrow();
  });

  it("status().contractWatcherCount reflects the live count", () => {
    const engine = new EventEngine({ network: "testnet" });

    expect(engine.status().contractWatcherCount).toBe(0);
    engine.subscribeContract("CAAA");
    expect(engine.status().contractWatcherCount).toBe(1);
    engine.subscribeContract("CBBB");
    expect(engine.status().contractWatcherCount).toBe(2);
    engine.unsubscribeContract("CAAA");
    expect(engine.status().contractWatcherCount).toBe(1);
  });
});
