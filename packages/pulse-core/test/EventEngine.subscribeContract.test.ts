import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { ContractEmittedEvent, ContractInvokedEvent } from "../src/index.js";

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
      expect.objectContaining({ type: "contract.emitted", contractId: "CABC1234" })
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
      "[pulse-core] subscribe() filter threw for address sub1 — treating as reject.",
      filterError
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
      "[pulse-core] subscribeContract() called for address sub1 which already has an active watcher — filter option ignored."
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

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C4" },
      { timeoutMs: 1000 },
    );

    // Any poll for the contract should satisfy
    engine.notifyContractPolled("C4", ["whatever"]);

    await expect(p).resolves.toBeUndefined();
  });
});
