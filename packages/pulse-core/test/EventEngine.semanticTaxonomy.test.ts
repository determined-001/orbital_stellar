/**
 * `semantic` resolution on `contract.emitted` events (issue #909): the
 * already-built, already-tested `TaxonomyResolver` wired into the live
 * event pipeline. These tests cover the wiring, not the resolver's own
 * precedence/wildcard/conflict rules - `taxonomyResolver.test.ts` in
 * abi-registry already covers those.
 *
 * `resolveSemantic()` builds its `ResolvableEvent` from the raw topics and
 * contract id alone - it does not know a contract's WASM hash or which SEP
 * interfaces it implements, because nothing in this pipeline determines
 * that today (no ABI spec field records it; see `spec.ts`). `contract`- and
 * `wasmHash`-scoped entries (when a hash is supplied) work correctly right
 * now; the bundled `SEP41_TAXONOMY` is `interface`-scoped and therefore
 * never matches through this wiring alone - see the last test below.
 */
import { describe, it, expect, vi } from "vitest";
import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { EventEngine } from "../src/EventEngine.js";
import type { ContractEmittedEvent } from "../src/index.js";
import type { TaxonomyEntry } from "@orbital-stellar/abi-registry";

function sym(name: string): string {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}
function addrTopic(g: string): string {
  return new Address(g).toScVal().toXDR("base64");
}

const SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const TRANSFER_ENTRY: TaxonomyEntry = {
  id: "test-transfer",
  version: "1.0.0",
  name: "asset.transferred",
  title: "Test transfer",
  description: "A contract-scoped stand-in for SEP41_TAXONOMY's interface-scoped transfer entry.",
  match: {
    topics: [
      { kind: "symbol", symbol: "transfer" },
      { kind: "any", type: "address" },
      { kind: "any", type: "address" },
    ],
  },
  scope: { kind: "contract", contractIds: [SAC] },
  provenance: {
    submittedBy: "@test",
    submittedAt: "2026-01-01T00:00:00Z",
    sources: ["https://example.org"],
  },
};

function buildEngine(taxonomy?: ReadonlyArray<TaxonomyEntry> | false): {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
} {
  const engine = new EventEngine({ network: "testnet", abiRegistry: false, taxonomy });

  let capturedOnMessage: ((record: unknown) => void) | null = null;

  vi.spyOn((engine as any).server, "operations").mockImplementation(() => ({
    join() {
      return this;
    },
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
    contract_id: SAC,
    topics: [
      sym("transfer"),
      addrTopic(Keypair.random().publicKey()),
      addrTopic(Keypair.random().publicKey()),
    ],
    data: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function deliveredEvent(
  engine: EventEngine,
  simulateRecord: (record: unknown) => void,
  record: Record<string, unknown>,
): ContractEmittedEvent | undefined {
  const watcher = engine.subscribeContract("sub1", {
    filters: [{ contractIds: [String(record.contract_id)] }],
  });
  const events: ContractEmittedEvent[] = [];
  watcher.on("contract.emitted", (e) => events.push(e as ContractEmittedEvent));
  simulateRecord(record);
  return events[0];
}

describe("EventEngine - semantic taxonomy wiring (#909)", () => {
  it("populates semantic when a contract-scoped entry matches", () => {
    const { engine, simulateRecord } = buildEngine([TRANSFER_ENTRY]);
    const event = deliveredEvent(engine, simulateRecord, makeEmittedRecord());

    expect(event?.semantic).toEqual({
      name: "asset.transferred",
      entryId: "test-transfer",
      entryVersion: "1.0.0",
      scope: "contract",
      deprecated: false,
    });
  });

  it("leaves semantic unset for an event no configured entry covers", () => {
    const { engine, simulateRecord } = buildEngine([TRANSFER_ENTRY]);
    const event = deliveredEvent(
      engine,
      simulateRecord,
      makeEmittedRecord({ topics: [sym("some_unmapped_function")] }),
    );

    expect(event?.semantic).toBeUndefined();
  });

  it("leaves semantic unset when config.taxonomy is false", () => {
    const { engine, simulateRecord } = buildEngine(false);
    const event = deliveredEvent(engine, simulateRecord, makeEmittedRecord());

    expect(event?.semantic).toBeUndefined();
  });

  it(
    "the default SEP41_TAXONOMY does not resolve through this wiring alone " +
      "(interface-scoped, and nothing here determines SEP interface conformance yet)",
    () => {
      const { engine, simulateRecord } = buildEngine(); // default: SEP41_TAXONOMY
      const event = deliveredEvent(engine, simulateRecord, makeEmittedRecord());

      expect(event?.semantic).toBeUndefined();
    },
  );
});
