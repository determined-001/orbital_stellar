import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { ContractSubscriptionConfig } from "../src/index.js";

function buildEngine(log?: any): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet", logger: log });

  let capturedOnMessage: ((record: unknown) => void) | null = null;

  vi.spyOn((engine as any).server, "operations").mockImplementation(() => ({
    cursor: () => ({
      stream: (callbacks: { onmessage: (r: unknown) => void }) => {
        capturedOnMessage = callbacks.onmessage;
        return () => {};
      },
    }),
  }));

  engine.start();

  return {
    engine,
    simulateRecord: (record) => {
      if (!capturedOnMessage) throw new Error("Stream not opened");
      capturedOnMessage(record);
    },
  };
}

function makeEmittedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contract_event",
    contract_id: "CABC1234",
    topics: ["transfer", "GABC"],
    data: { amount: "100" },
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventEngine.subscribeContract — filter predicate", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers events to a watcher whose filter returns true", () => {
    const { engine, simulateRecord } = buildEngine(log);
    const watcher = engine.subscribeContract("sub1", {
      filter: (e) => (e as any).contractId === "CABC1234",
    });
    const handler = vi.fn();
    watcher.on("contract.emitted", handler);

    simulateRecord(makeEmittedRecord({ contract_id: "CABC1234" }));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "contract.emitted", contractId: "CABC1234" }),
    );
  });

  it("suppresses events for a watcher whose filter returns false", () => {
    const { engine, simulateRecord } = buildEngine(log);
    const watcher = engine.subscribeContract("sub1", {
      filter: (e) => (e as any).contractId !== "CABC1234",
    });
    const handler = vi.fn();
    watcher.on("*", handler);

    simulateRecord(makeEmittedRecord({ contract_id: "CABC1234" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("treats a throwing filter as a reject and logs a warning without crashing the engine", () => {
    const { engine, simulateRecord } = buildEngine(log);
    const filterError = new Error("filter boom");
    const watcher = engine.subscribeContract("sub1", {
      filter: () => {
        throw filterError;
      },
    });
    const handler = vi.fn();
    watcher.on("*", handler);

    simulateRecord(makeEmittedRecord());

    expect(handler).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] subscribe() filter threw for address. Treating as reject.",
      { address: "sub1", error: filterError },
    );

    // Verify engine continues to deliver to other watchers
    const otherWatcher = engine.subscribeContract("sub2");
    const otherHandler = vi.fn();
    otherWatcher.on("*", otherHandler);

    simulateRecord(makeEmittedRecord());
    expect(otherHandler).toHaveBeenCalledOnce();
  });

  it("warns and ignores filter when re-subscribing to an already-watched contract ID", () => {
    const { engine } = buildEngine(log);
    const first = engine.subscribeContract("sub1");
    const second = engine.subscribeContract("sub1", { filter: () => false });

    expect(second).toBe(first);
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] subscribeContract() called for address sub1 which already has an active watcher — filter option ignored.",
    );
  });

  it("unsubscribeContract cleans up the filter", () => {
    const { engine } = buildEngine(log);
    engine.subscribeContract("sub1", {
      filter: () => true,
    });

    expect((engine as any).filters.has("sub1")).toBe(true);

    engine.unsubscribeContract("sub1");
    expect((engine as any).filters.has("sub1")).toBe(false);
  });
});

describe("EventEngine.awaitContractSubscriptionActive", () => {
  it("resolves when a poll includes the requested topics", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C1", topics: ["t1", "t2"] },
      { timeoutMs: 1000 },
    );

    // Simulate a poll that includes the requested topics (order differs)
    engine.notifyContractPolled("C1", ["t2", "t3", "t1"]);

    await expect(p).resolves.toBeUndefined();
  });

  it("resolves when a poll has no topic restriction (covers all)", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C2", topics: ["alpha"] },
      { timeoutMs: 1000 },
    );

    // Simulate a poll with no topics (covers all topics)
    engine.notifyContractPolled("C2", undefined);

    await expect(p).resolves.toBeUndefined();
  });

  it("does not resolve if polled topics do not include requested topics", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C3", topics: ["x", "y"] },
      { timeoutMs: 50 },
    );

    // Simulate a poll that doesn't include all requested topics
    engine.notifyContractPolled("C3", ["x"]);

    await expect(p).rejects.toThrow("awaitContractSubscriptionActive: timeout");
  });

  it("resolves immediately when no topics requested", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive({ contractId: "C4" }, { timeoutMs: 1000 });

    // Any poll for the contract should satisfy
    engine.notifyContractPolled("C4", ["whatever"]);

    await expect(p).resolves.toBeUndefined();
  });
});

function makeEngine(): EventEngine {
  return new EventEngine({ network: "testnet" });
}

describe("engine.subscribeContract(config)", () => {
  it("returns a Watcher for a valid config", () => {
    const engine = makeEngine();
    const watcher = engine.subscribeContract({
      filters: [{ contractIds: ["CA1234"] }],
    });
    expect(watcher).toBeDefined();
    expect(typeof watcher.on).toBe("function");
  });

  it("returns the same Watcher instance for semantically equal configs", () => {
    const engine = makeEngine();
    const config: ContractSubscriptionConfig = {
      filters: [{ contractIds: ["CA1234"] }],
    };
    const w1 = engine.subscribeContract(config);
    const w2 = engine.subscribeContract({ filters: [{ contractIds: ["CA1234"] }] });
    expect(w1).toBe(w2);
  });

  it("deduplicates regardless of contractIds order", () => {
    const engine = makeEngine();
    const w1 = engine.subscribeContract({ filters: [{ contractIds: ["CA", "CB"] }] });
    const w2 = engine.subscribeContract({ filters: [{ contractIds: ["CB", "CA"] }] });
    expect(w1).toBe(w2);
  });

  it("returns different Watchers for different filter shapes", () => {
    const engine = makeEngine();
    const w1 = engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });
    const w2 = engine.subscribeContract({ filters: [{ contractIds: ["CB"] }] });
    expect(w1).not.toBe(w2);
  });

  it("accepts an empty filters array", () => {
    const engine = makeEngine();
    expect(() => engine.subscribeContract({ filters: [] })).not.toThrow();
  });

  it("accepts exactly 5 filters", () => {
    const engine = makeEngine();
    const filters = Array.from({ length: 5 }, (_, i) => ({ contractIds: [`C${i}`] }));
    expect(() => engine.subscribeContract({ filters })).not.toThrow();
  });

  it("throws synchronously when filters.length > 5", () => {
    const engine = makeEngine();
    const filters = Array.from({ length: 6 }, (_, i) => ({ contractIds: [`C${i}`] }));
    expect(() => engine.subscribeContract({ filters })).toThrow(/filters.*≤ 5/i);
  });

  it("throws synchronously when a filter's contractIds.length > 5", () => {
    const engine = makeEngine();
    const contractIds = ["C1", "C2", "C3", "C4", "C5", "C6"];
    expect(() => engine.subscribeContract({ filters: [{ contractIds }] })).toThrow(
      /contractIds.*≤ 5/i,
    );
  });

  it("accepts a filter with exactly 5 contractIds", () => {
    const engine = makeEngine();
    const contractIds = ["C1", "C2", "C3", "C4", "C5"];
    expect(() => engine.subscribeContract({ filters: [{ contractIds }] })).not.toThrow();
  });

  it("accepts all optional ContractFilter fields", () => {
    const engine = makeEngine();
    expect(() =>
      engine.subscribeContract({
        filters: [
          {
            type: "contract",
            contractIds: ["CA1234"],
            topics: [["transfer"], ["GABC"]],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts type 'system'", () => {
    const engine = makeEngine();
    expect(() => engine.subscribeContract({ filters: [{ type: "system" }] })).not.toThrow();
  });

  it("accepts type 'diagnostic'", () => {
    const engine = makeEngine();
    expect(() => engine.subscribeContract({ filters: [{ type: "diagnostic" }] })).not.toThrow();
  });

  it("does not interfere with the legacy string-id subscribeContract", () => {
    const engine = makeEngine();
    const legacyWatcher = engine.subscribeContract("my-sub");
    const configWatcher = engine.subscribeContract({ filters: [{ contractIds: ["CA"] }] });
    expect(legacyWatcher).not.toBe(configWatcher);
  });

  it("stop() removes the watcher so a new call creates a fresh instance", () => {
    const engine = makeEngine();
    const config: ContractSubscriptionConfig = { filters: [{ contractIds: ["CA"] }] };
    const w1 = engine.subscribeContract(config);
    w1.stop();
    const w2 = engine.subscribeContract(config);
    expect(w1).not.toBe(w2);
  });
});
