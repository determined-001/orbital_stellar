import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadTaxonomyResolver } from "@orbital-stellar/abi-registry";
import { EventEngine } from "../src/EventEngine.js";
import type { AbiRegistryClientLike, TaxonomyResolverLike } from "../src/index.js";
import type { ContractEmittedEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors EventEngine.abiRegistry.test.ts's setup)
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

// A full ContractSpec-shaped object (not the bare XdrContractSpec form) so
// `isFullContractSpec` in EventEngine.ts treats it as spec/interface-capable -
// exposes all four canonical SAC events so the bundled default taxonomy's
// `classifyKnownInterface` heuristic fires.
const SAC_LIKE_SPEC = {
  version: "1.0.0",
  name: "test-token",
  contractId: "CABC1234",
  functions: [],
  events: [
    { name: "transfer", topics: [], data: [] },
    { name: "mint", topics: [], data: [] },
    { name: "burn", topics: [], data: [] },
    { name: "clawback", topics: [], data: [] },
  ],
  types: {},
};

function buildEngine(config: {
  abiRegistry?: AbiRegistryClientLike | false;
  taxonomy?: TaxonomyResolverLike | false;
}): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet", ...config });

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

async function receiveOne(engine: EventEngine, simulateRecord: (r: unknown) => void): Promise<ContractEmittedEvent> {
  const received: ContractEmittedEvent[] = [];
  const watcher = engine.subscribeContract("sub1", { filters: [{ contractIds: ["CABC1234"] }] });
  watcher.on("contract.emitted", (e) => received.push(e as ContractEmittedEvent));
  simulateRecord(makeEmittedRecord());
  await vi.waitFor(() => expect(received).toHaveLength(1));
  return received[0]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventEngine - semantic taxonomy integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("populates semantic from an explicit contractId-scoped resolver", async () => {
    const abiRegistry: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(SAC_LIKE_SPEC) };
    const taxonomy = loadTaxonomyResolver([
      {
        version: "1.0.0",
        mappings: [{ scope: { contractId: "CABC1234" }, eventTopic: "transfer", semantic: "custom.transfer" }],
      },
    ]);

    const { engine, simulateRecord } = buildEngine({ abiRegistry, taxonomy });
    const event = await receiveOne(engine, simulateRecord);

    expect(event.semantic).toBe("custom.transfer");
  });

  it("resolves via the bundled default taxonomy + interface classification when taxonomy is omitted", async () => {
    const abiRegistry: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(SAC_LIKE_SPEC) };

    const { engine, simulateRecord } = buildEngine({ abiRegistry });
    const event = await receiveOne(engine, simulateRecord);

    expect(event.semantic).toBe("token.transferred");
  });

  it("leaves semantic undefined when taxonomy: false, even though decodedData resolves", async () => {
    const abiRegistry: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(SAC_LIKE_SPEC) };

    const { engine, simulateRecord } = buildEngine({ abiRegistry, taxonomy: false });
    const event = await receiveOne(engine, simulateRecord);

    expect(event.decodedData).toBeDefined();
    expect(event.semantic).toBeUndefined();
  });

  it("leaves semantic undefined for an event topic no mapping covers — never guessed", async () => {
    const abiRegistry: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(SAC_LIKE_SPEC) };
    const taxonomy = loadTaxonomyResolver([
      { version: "1.0.0", mappings: [{ scope: { contractId: "CABC1234" }, eventTopic: "swap", semantic: "swap.executed" }] },
    ]);

    const { engine, simulateRecord } = buildEngine({ abiRegistry, taxonomy });
    const event = await receiveOne(engine, simulateRecord); // record's topic[0] is "transfer", not "swap"

    expect(event.semantic).toBeUndefined();
  });

  it("leaves semantic undefined when the spec is a bare XdrContractSpec (no events array)", async () => {
    const abiRegistry: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue({ contractId: "CABC1234", entries: [] }),
    };

    const { engine, simulateRecord } = buildEngine({ abiRegistry }); // default bundled taxonomy
    const event = await receiveOne(engine, simulateRecord);

    expect(event.decodedData).toBeDefined();
    expect(event.semantic).toBeUndefined(); // no interfaceId could be classified without an events array
  });
});
