import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { ContractEmittedEvent, ContractInvokedEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEngine(): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet" });

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

function makeInvokedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contract_invocation",
    contract_id: "CABC1234",
    function: "transfer",
    topics: ["transfer"],
    data: null,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventEngine — contract event routing", () => {
  it("drops a contract.emitted event when no contract subscriptions exist", () => {
    const { engine, simulateRecord } = buildEngine();
    // Classic address watcher — should not receive contract events
    const watcher = engine.subscribe("GABC1234");
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord());

    expect(received).toHaveLength(0);
  });

  it("drops a contract.emitted event when no filter matches", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["COTHER999"] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ contract_id: "CABC1234" }));

    expect(received).toHaveLength(0);
  });

  it("delivers contract.emitted to a subscription with matching contractId", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CABC1234"] }],
    });
    const received: ContractEmittedEvent[] = [];
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord());

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "contract.emitted",
      contractId: "CABC1234",
      topics: ["transfer", "GABC"],
      data: { amount: "100" },
      timestamp: "2024-01-01T00:00:00Z",
    });
  });

  it("delivers contract.emitted on the '*' wildcard", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CABC1234"] }],
    });
    const wildcard: unknown[] = [];
    watcher.on("*", (e) => wildcard.push(e));

    simulateRecord(makeEmittedRecord());

    expect(wildcard).toHaveLength(1);
  });

  it("delivers contract.invoked to a matching subscription", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ type: "contract.invoked", contractIds: ["CABC1234"] }],
    });
    const received: ContractInvokedEvent[] = [];
    watcher.on("contract.invoked", (e) => received.push(e as ContractInvokedEvent));

    simulateRecord(makeInvokedRecord());

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "contract.invoked",
      contractId: "CABC1234",
      function: "transfer",
    });
  });

  it("does not deliver contract.invoked to a subscription filtered to contract.emitted", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ type: "contract.emitted" }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeInvokedRecord());

    expect(received).toHaveLength(0);
  });

  it("matches a topic-pattern filter positionally (null = wildcard)", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["transfer", null] }],
    });
    const received: unknown[] = [];
    watcher.on("contract.emitted", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ topics: ["transfer", "GABC"] }));

    expect(received).toHaveLength(1);
  });

  it("rejects an event whose first topic does not match the pattern", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["mint"] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ topics: ["transfer", "GABC"] }));

    expect(received).toHaveLength(0);
  });

  it("delivers to two overlapping subscriptions independently (no dedup)", () => {
    const { engine, simulateRecord } = buildEngine();

    const w1 = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CABC1234"] }],
    });
    const w2 = engine.subscribeContract("sub2", {
      filters: [{ topicFilters: ["transfer", null] }],
    });

    const r1: unknown[] = [];
    const r2: unknown[] = [];
    w1.on("contract.emitted", (e) => r1.push(e));
    w2.on("contract.emitted", (e) => r2.push(e));

    simulateRecord(makeEmittedRecord());

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("a subscription with no filters matches all contract events", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1");
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ contract_id: "CANY" }));
    simulateRecord(makeInvokedRecord({ contract_id: "COTHER" }));

    expect(received).toHaveLength(2);
  });

  it("drops a contract_event record with missing contract_id", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1");
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ contract_id: "" }));

    expect(received).toHaveLength(0);
  });

  it("unsubscribeContract stops delivery", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1");
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    engine.unsubscribeContract("sub1");
    simulateRecord(makeEmittedRecord());

    expect(received).toHaveLength(0);
  });
});
