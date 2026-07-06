import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";

// ---------------------------------------------------------------------------
// Additional edge-case coverage for contract event routing.
//
// EventEngine.routeContract.test.ts already covers the headline behaviours
// (drop-on-no-match, topic-pattern delivery, independent overlapping
// subscriptions). These cases exercise the finer matching rules that the
// RPC contract-filter semantics imply but that aren't otherwise pinned down:
//   * contractId *membership* across a multi-id filter,
//   * positional topic patterns with interior wildcards and short patterns,
//   * AND-within-a-filter vs OR-across-filters,
//   * topic filters being inapplicable to contract.invoked events.
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

describe("EventEngine — contract event routing (edge cases)", () => {
  // ── contractId membership ──────────────────────────────────────────────────

  it("delivers when the event's contractId is any member of a multi-id filter", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CA111", "CB222", "CC333"] }],
    });
    const received: unknown[] = [];
    watcher.on("contract.emitted", (e) => received.push(e));

    // Middle of the membership list.
    simulateRecord(makeEmittedRecord({ contract_id: "CB222" }));

    expect(received).toHaveLength(1);
  });

  it("drops when the event's contractId is in none of a multi-id filter", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CA111", "CB222", "CC333"] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ contract_id: "CZ999" }));

    expect(received).toHaveLength(0);
  });

  // ── positional topic patterns ──────────────────────────────────────────────

  it("matches an interior wildcard in a multi-segment topic pattern", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["transfer", null, "memo"] }],
    });
    const received: unknown[] = [];
    watcher.on("contract.emitted", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ topics: ["transfer", "GABC", "memo"] }));

    expect(received).toHaveLength(1);
  });

  it("rejects when a non-wildcard segment after the first differs", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["transfer", null, "memo"] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ topics: ["transfer", "GABC", "other"] }));

    expect(received).toHaveLength(0);
  });

  it("a pattern shorter than the event topics only constrains the leading segments", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["transfer"] }],
    });
    const received: unknown[] = [];
    watcher.on("contract.emitted", (e) => received.push(e));

    simulateRecord(makeEmittedRecord({ topics: ["transfer", "GABC", "extra"] }));

    expect(received).toHaveLength(1);
  });

  // ── AND within a filter / OR across filters ────────────────────────────────

  it("requires all conditions within a single filter to match (AND)", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CABC1234"], topicFilters: ["transfer", null] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    // contractId matches, but the topic pattern does not → dropped.
    simulateRecord(makeEmittedRecord({ contract_id: "CABC1234", topics: ["mint", "GABC"] }));

    expect(received).toHaveLength(0);
  });

  it("delivers when any one of several filters matches (OR)", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CX000"] }, { topicFilters: ["mint"] }],
    });
    const received: unknown[] = [];
    watcher.on("contract.emitted", (e) => received.push(e));

    // Fails the first filter (wrong contractId) but satisfies the second.
    simulateRecord(makeEmittedRecord({ contract_id: "CABC1234", topics: ["mint", "GABC"] }));

    expect(received).toHaveLength(1);
  });

  // ── topic filters are emitted-only ─────────────────────────────────────────

  it("does not apply topic filters to contract.invoked events", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribeContract("sub1", {
      filters: [{ topicFilters: ["transfer"] }],
    });
    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    // An invocation whose topic would match the pattern is still dropped:
    // topic filters only constrain contract.emitted events.
    simulateRecord(makeInvokedRecord({ topics: ["transfer"] }));

    expect(received).toHaveLength(0);
  });
});
