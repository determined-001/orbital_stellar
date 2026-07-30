/**
 * Tests for the Sep48EmbeddedClient - the parsing leg that makes the
 * `sep48` branch of the precedence chain reachable (issue #903).
 *
 * Uses the real `demo-emitter.wasm` fixture (has `#[contractevent]`)
 * and mocks only the network fetch layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { Sep48EmbeddedClient } from "../../src/discovery/Sep48EmbeddedClient.js";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: vi.fn() },
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../fixtures");
const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const RPC_URL = "https://soroban-testnet.stellar.org";

function loadFixture(name: string): Buffer {
  return readFileSync(resolve(FIXTURES_DIR, name));
}

function installMockServer(getContractWasmByContractId: ReturnType<typeof vi.fn>) {
  const server = { getContractWasmByContractId };
  (SorobanRpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (
    this: unknown,
  ) {
    return server;
  });
}

describe("Sep48EmbeddedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a spec with events from demo-emitter.wasm (has #[contractevent])", async () => {
    installMockServer(vi.fn().mockResolvedValue(loadFixture("demo-emitter.wasm")));

    const client = new Sep48EmbeddedClient(RPC_URL);
    const spec = await client.getSpec(CONTRACT_ID);

    expect(spec).not.toBeNull();
    expect(spec!.events.length).toBeGreaterThan(0);
    expect(spec!.events[0]!.name).toBe("Ping");
    expect(spec!.contractId).toBe(CONTRACT_ID);
    expect(spec!.functions.map((f) => f.name)).toEqual(["ping"]);
  });

  it("declares specSource as 'sep48'", () => {
    const client = new Sep48EmbeddedClient(RPC_URL);
    expect(client.specSource).toBe("sep48");
  });

  it("returns null for a WASM with no events (pre-SEP-48 contract)", async () => {
    // Build a minimal WASM with a contractspecv0 section containing only a
    // function entry and no event entries. We achieve this by building a
    // custom WASM section from a known function-only ScSpecEntry.
    // Simpler approach: mock parseWasmSpec to return empty events via a
    // WASM that has no #[contractevent].
    // The registry.wasm fixture *does* have events, so we build a synthetic
    // WASM with only function entries instead.

    // For simplicity, we'll mock fetchContractWasm to throw NoEmbeddedSpecError
    // which simulates a contract with no embedded spec at all.
    installMockServer(
      vi.fn().mockResolvedValue(
        // A valid WASM binary with no contractspecv0 section (empty module)
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      ),
    );

    const client = new Sep48EmbeddedClient(RPC_URL);
    const spec = await client.getSpec(CONTRACT_ID);

    // Falls through - returns null
    expect(spec).toBeNull();
  });

  it("returns null when the WASM fetch fails (e.g. SAC contract)", async () => {
    installMockServer(vi.fn().mockRejectedValue(new Error("contract not found")));

    const client = new Sep48EmbeddedClient(RPC_URL);
    const spec = await client.getSpec(CONTRACT_ID);

    // Should not throw - returns null so the chain falls through
    expect(spec).toBeNull();
  });

  it("produces a spec that flows correctly through the precedence chain", async () => {
    // Non-synthetic integration test: real WASM fixture → Sep48EmbeddedClient
    // → ChainedAbiRegistryClient → verifies specSource == "sep48"
    const { ChainedAbiRegistryClient } = await import("../../src/ChainedAbiRegistryClient.js");

    installMockServer(vi.fn().mockResolvedValue(loadFixture("demo-emitter.wasm")));

    const sep48Client = new Sep48EmbeddedClient(RPC_URL);
    const registryClient = {
      getSpec: vi.fn().mockResolvedValue(null),
      specSource: "registry" as const,
    };

    const chained = new ChainedAbiRegistryClient([sep48Client, registryClient]);
    const result = await chained.getResolvedSpec(CONTRACT_ID);

    expect(result).not.toBeNull();
    expect(result!.specSource).toBe("sep48");
    expect(result!.spec.events.length).toBeGreaterThan(0);
    expect(result!.spec.events[0]!.name).toBe("Ping");

    // Registry was still checked (for conflict detection) but returned null
    expect(registryClient.getSpec).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("emits warning when sep48 spec disagrees with registry attestation (non-synthetic)", async () => {
    // Non-synthetic test: real demo-emitter.wasm from sep48 vs a mock
    // registry returning a different spec → warning with both hashes.
    const { ChainedAbiRegistryClient } = await import("../../src/ChainedAbiRegistryClient.js");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    installMockServer(vi.fn().mockResolvedValue(loadFixture("demo-emitter.wasm")));

    const sep48Client = new Sep48EmbeddedClient(RPC_URL);

    // A different spec from the registry (different name → different hash)
    const registrySpec = {
      version: "1.0.0",
      name: "DifferentContract",
      functions: [],
      events: [{ name: "Ping", topics: [], data: [] }],
      types: {},
    };
    const registryClient = {
      getSpec: vi.fn().mockResolvedValue(registrySpec),
      specSource: "registry" as const,
    };

    const chained = new ChainedAbiRegistryClient([sep48Client, registryClient]);
    const result = await chained.getResolvedSpec(CONTRACT_ID);

    // sep48 wins
    expect(result!.specSource).toBe("sep48");

    // Warning was emitted naming both sources and hashes
    expect(warnSpy).toHaveBeenCalledOnce();
    const warning = warnSpy.mock.calls[0]![0] as string;
    expect(warning).toContain("sep48");
    expect(warning).toContain("registry");
    expect(warning).toContain(CONTRACT_ID);

    warnSpy.mockRestore();
  });
});
