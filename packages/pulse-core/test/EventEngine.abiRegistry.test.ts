import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { AbiRegistryClientLike } from "../src/index.js";
import type { ContractEmittedEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmittedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contract_event",
    contract_id: "CABC1234",
    topics: ["transfer", "GABC"],
    data: { amount: "100" },
    ledger: 1000,
    event_id: "evt-001",
    tx_hash: "txhash001",
    in_successful_contract_call: true,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function buildEngine(abiRegistry?: AbiRegistryClientLike | false): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet", abiRegistry });

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventEngine - ABI registry integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("populates decodedData with the decoded event (not the raw spec) when the registry returns a spec for the contractId", async () => {
    const spec = { contractId: "CABC1234", entries: ["base64entry=="] };
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(spec),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: ["CABC1234"] }],
    });
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord());

    // Allow the async getSpec promise to resolve
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(abiRegistry.getSpec).toHaveBeenCalledWith("CABC1234");
    expect(received[0]!.decodedData).toEqual({
      functionName: "transfer",
      topics: ["transfer", "GABC"],
      data: "100",
    });
  });

  it("emits event.decode_failed and leaves decodedData undefined on a registry miss", async () => {
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(null),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: ContractEmittedEvent[] = [];
    const notifications: Array<{
      type: string;
      contractId: string;
      eventId?: string;
      error: string;
    }> = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));
    watcher.on("event.decode_failed", (e) => {
      notifications.push(
        e as { type: string; contractId: string; eventId?: string; error: string },
      );
    });

    simulateRecord(makeEmittedRecord({ event_id: "evt-miss" }));

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]!.decodedData).toBeUndefined();
    expect(notifications).toEqual([
      {
        type: "event.decode_failed",
        contractId: "CABC1234",
        eventId: "evt-miss",
        error:
          "No ABI spec found for contract CABC1234; publish an ABI spec through the registry or follow issue #8.1 for guidance.",
      },
    ]);
  });

  it("routes the event without decodedData and emits event.decode_failed when getSpec rejects", async () => {
    const warnSpy = vi.fn();
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockRejectedValue(new Error("network timeout")),
    };

    const engine = new EventEngine({
      network: "testnet",
      abiRegistry,
      logger: { info: vi.fn(), warn: warnSpy, error: vi.fn() },
    });

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

    const received: ContractEmittedEvent[] = [];
    const notifications: Array<{
      type: string;
      contractId: string;
      eventId?: string;
      error: string;
    }> = [];
    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));
    watcher.on("event.decode_failed", (e) => {
      notifications.push(
        e as { type: string; contractId: string; eventId?: string; error: string },
      );
    });

    capturedOnMessage!(makeEmittedRecord({ event_id: "evt-reject" }));

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]!.decodedData).toBeUndefined();
    expect(notifications).toEqual([
      {
        type: "event.decode_failed",
        contractId: "CABC1234",
        eventId: "evt-reject",
        error: "network timeout",
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ABI registry lookup failed"),
      expect.objectContaining({ contractId: "CABC1234" }),
    );
  });

  it("performs no ABI lookup and leaves decodedData undefined when abiRegistry: false", () => {
    const { engine, simulateRecord } = buildEngine(false);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord());

    // Synchronous delivery - no async step needed
    expect(received).toHaveLength(1);
    expect(received[0]!.decodedData).toBeUndefined();
  });

  it("resolves the bundled well-known registry by default when abiRegistry is omitted entirely", async () => {
    const USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
    // abiRegistry omitted - buildEngine(undefined) passes CoreConfig.abiRegistry
    // as undefined, which now resolves createDefaultAbiRegistryClient().
    const { engine, simulateRecord } = buildEngine(undefined);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1", {
      filters: [{ contractIds: [USDC] }],
    });
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(
      makeEmittedRecord({
        contract_id: USDC,
        topics: [{ sym: "transfer" }, { address: "GFROM" }, { address: "GTO" }],
        data: { i128: "10000000" },
      }),
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]!.decodedData).toEqual({
      functionName: "transfer",
      topics: ["transfer", "GFROM", "GTO"],
      data: "10000000",
    });
  });

  it("calls getSpecAt with the event's ledger instead of getSpec, when implemented", async () => {
    const spec = { contractId: "CABC1234", entries: ["versioned-entry=="] };
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue({ contractId: "CABC1234", entries: ["latest-entry=="] }),
      getSpecAt: vi.fn().mockResolvedValue(spec),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord({ ledger: 42000 }));

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(abiRegistry.getSpecAt).toHaveBeenCalledWith("CABC1234", 42000);
    expect(abiRegistry.getSpec).not.toHaveBeenCalled();
    expect(received[0]!.decodedData).toEqual({
      functionName: "transfer",
      topics: ["transfer", "GABC"],
      data: "100",
    });
  });

  it("falls back to getSpec when getSpecAt is implemented but the event has no ledger", async () => {
    const spec = { contractId: "CABC1234", entries: ["latest-entry=="] };
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(spec),
      getSpecAt: vi.fn().mockResolvedValue(null),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    const record = makeEmittedRecord();
    delete record.ledger;
    simulateRecord(record);

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(abiRegistry.getSpecAt).not.toHaveBeenCalled();
    expect(abiRegistry.getSpec).toHaveBeenCalledWith("CABC1234");
    expect(received[0]!.decodedData).toEqual({
      functionName: "transfer",
      topics: ["transfer", "GABC"],
      data: "100",
    });
  });

  it("does not call getSpec for contract.invoked events", async () => {
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(null),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: unknown[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.invoked", (e) => received.push(e));

    simulateRecord({
      type: "contract_invocation",
      contract_id: "CABC1234",
      function: "transfer",
      args: [],
      ledger: 1000,
      tx_hash: "txhash001",
      created_at: "2024-01-01T00:00:00Z",
    });

    expect(received).toHaveLength(1);
    expect(abiRegistry.getSpec).not.toHaveBeenCalled();
  });
});
