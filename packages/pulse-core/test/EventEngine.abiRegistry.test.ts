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

function buildEngine(abiRegistry?: AbiRegistryClientLike): {
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

describe("EventEngine — ABI registry integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("populates decodedData when the registry returns a spec for the contractId", async () => {
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
    expect(received[0]!.decodedData).toEqual(spec.entries);
  });

  it("leaves decodedData undefined on a registry miss (null spec)", async () => {
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(null),
    };

    const { engine, simulateRecord } = buildEngine(abiRegistry);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord());

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]!.decodedData).toBeUndefined();
  });

  it("routes the event without decodedData and logs a warning when getSpec rejects", async () => {
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
    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    capturedOnMessage!(makeEmittedRecord());

    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]!.decodedData).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ABI registry lookup failed"),
      expect.objectContaining({ contractId: "CABC1234" })
    );
  });

  it("skips ABI lookup entirely when no abiRegistry is configured", async () => {
    // No abiRegistry — engine constructed without it
    const { engine, simulateRecord } = buildEngine(undefined);
    const received: ContractEmittedEvent[] = [];

    const watcher = engine.subscribeContract("sub1");
    watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));

    simulateRecord(makeEmittedRecord());

    // Synchronous delivery — no async step needed
    expect(received).toHaveLength(1);
    expect(received[0]!.decodedData).toBeUndefined();
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
