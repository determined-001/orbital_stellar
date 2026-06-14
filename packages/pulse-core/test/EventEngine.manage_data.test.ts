import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { DataEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Minimal record factories matching the shape Horizon sends
// ---------------------------------------------------------------------------

function makeManageDataRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "manage_data",
    source_account: "GABC1234",
    data_name: "federation",
    data_value: "aGVsbG8=", // base64 "hello"
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers to reach the private normalize path through the public stream
// ---------------------------------------------------------------------------

function buildEngine(): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet" });

  // Capture the onmessage callback that openStream registers so we can
  // feed fake records into it without a live SSE connection.
  let capturedOnMessage: ((record: unknown) => void) | null = null;

  const originalOperations = (engine as any).server.operations.bind((engine as any).server);

  vi.spyOn((engine as any).server, "operations").mockImplementation(() => {
    const builder = originalOperations();
    vi.spyOn(builder, "cursor").mockReturnValue(builder);
    vi.spyOn(builder, "stream").mockImplementation(((callbacks: {
      onmessage: (r: unknown) => void;
    }) => {
      capturedOnMessage = callbacks.onmessage;
      return () => {};
    }) as any);
    return builder;
  });

  engine.start();

  return {
    engine,
    simulateRecord: (record) => {
      if (!capturedOnMessage) throw new Error("Stream not opened");
      capturedOnMessage(record);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventEngine — manage_data normalization", () => {
  it('emits "data.set" when data_value is present', () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const received: DataEvent[] = [];
    watcher.on("data.set", (e) => received.push(e as DataEvent));

    simulateRecord(makeManageDataRecord());

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "data.set",
      source: "GABC1234",
      name: "federation",
      value: "aGVsbG8=",
      timestamp: "2024-01-01T00:00:00Z",
    });
  });

  it('emits "data.cleared" when data_value is null', () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const received: DataEvent[] = [];
    watcher.on("data.cleared", (e) => received.push(e as DataEvent));

    simulateRecord(makeManageDataRecord({ data_value: null }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "data.cleared",
      source: "GABC1234",
      name: "federation",
      value: null,
    });
  });

  it('emits "data.cleared" when data_value is absent', () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const received: DataEvent[] = [];
    watcher.on("data.cleared", (e) => received.push(e as DataEvent));

    const record = makeManageDataRecord();
    delete record.data_value;
    simulateRecord(record);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("data.cleared");
    expect(received[0].value).toBeNull();
  });

  it('also emits on the "*" wildcard', () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const wildcard: DataEvent[] = [];
    watcher.on("*", (e) => wildcard.push(e as DataEvent));

    simulateRecord(makeManageDataRecord());

    expect(wildcard).toHaveLength(1);
    expect(wildcard[0].type).toBe("data.set");
  });

  it("drops records with a missing source_account", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeManageDataRecord({ source_account: "" }));

    expect(received).toHaveLength(0);
  });

  it("drops records with a missing data_name", () => {
    const { engine, simulateRecord } = buildEngine();
    const watcher = engine.subscribe("GABC1234");

    const received: unknown[] = [];
    watcher.on("*", (e) => received.push(e));

    simulateRecord(makeManageDataRecord({ data_name: "" }));

    expect(received).toHaveLength(0);
  });

  it("does not emit to an unrelated watcher", () => {
    const { engine, simulateRecord } = buildEngine();
    engine.subscribe("GABC1234");
    const bystander = engine.subscribe("GOTHER999");

    const received: unknown[] = [];
    bystander.on("*", (e) => received.push(e));

    simulateRecord(makeManageDataRecord());

    expect(received).toHaveLength(0);
  });
});
