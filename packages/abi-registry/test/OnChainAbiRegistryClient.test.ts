import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Address, Keypair, Networks, rpc as SorobanRpc, StrKey, xdr } from "@stellar/stellar-sdk";
import { OnChainAbiRegistryClient } from "../src/OnChainAbiRegistryClient.js";
import type { ContractSpec } from "../src/spec.js";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: vi.fn() },
  };
});

// Real, checksum-valid strkeys - Address/Contract in stellar-sdk validate the
// checksum, so hand-typed placeholder addresses won't pass construction.
const REGISTRY_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const TARGET_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PUBLISHER_ADDRESS = Keypair.random().publicKey();

function testSpec(overrides: Partial<ContractSpec> = {}): ContractSpec {
  return {
    version: "1.0.0",
    name: "Test Token",
    contractId: TARGET_CONTRACT_ID,
    network: "mainnet",
    functions: [],
    events: [],
    types: {},
    ...overrides,
  };
}

/**
 * Hand-builds the exact ScVal shape soroban-sdk's `#[contracttype]` produces
 * for the registry's `SpecRecord` struct: an `scvMap` with `scvSymbol` keys
 * and per-field-typed values. Built at the XDR level (not via `nativeToScVal`
 * object inference) so the test fixture's wire shape is unambiguous and
 * doesn't depend on guessing `nativeToScVal`'s struct-typing conventions.
 */
function specRecordScVal(record: {
  version: string;
  specHash: Buffer;
  pointer: string;
  publisher: string;
  publishedAt?: bigint;
  publishedAtLedger?: number;
}): xdr.ScVal {
  const entry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

  return xdr.ScVal.scvMap([
    entry("version", xdr.ScVal.scvString(record.version)),
    entry("spec_hash", xdr.ScVal.scvBytes(record.specHash)),
    entry("pointer", xdr.ScVal.scvString(record.pointer)),
    entry("publisher", new Address(record.publisher).toScVal()),
    entry("published_at", xdr.ScVal.scvU64(new xdr.Uint64(record.publishedAt ?? 1000n))),
    entry("published_at_ledger", xdr.ScVal.scvU32(record.publishedAtLedger ?? 100)),
  ]);
}

type MockServer = {
  simulateTransaction: ReturnType<typeof vi.fn>;
};

function installMockServer(simulateTransaction: ReturnType<typeof vi.fn>): MockServer {
  const server: MockServer = { simulateTransaction };
  (SorobanRpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (
    this: unknown,
  ) {
    return server;
  });
  return server;
}

const MAX_PAGE_SIZE = 25;

/** Routes simulateTransaction calls to list_versions / list_versions_paged / get_version based on the invoked function name. */
function routingSimulate(opts: { versions: string[]; records: Record<string, xdr.ScVal> }) {
  return vi
    .fn()
    .mockImplementation(
      async (tx: InstanceType<typeof import("@stellar/stellar-sdk").Transaction>) => {
        const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
        const invocation = op.func.invokeContract();
        const fnName = invocation.functionName().toString();

        if (fnName === "list_versions_paged") {
          const args = invocation.args();
          const start = Number((args[2] as xdr.ScVal).i32());
          const limit = Math.min(Number((args[3] as xdr.ScVal).i32()), MAX_PAGE_SIZE);
          const page = opts.versions.slice(start, start + limit);
          const nextCursor = start + limit < opts.versions.length ? start + limit : null;
          return {
            result: {
              retval: xdr.ScVal.scvVec([
                xdr.ScVal.scvVec(page.map((v) => xdr.ScVal.scvString(v))),
                nextCursor !== null ? xdr.ScVal.scvI32(nextCursor) : xdr.ScVal.scvVoid(),
              ]),
            },
          };
        }

        if (fnName === "list_versions") {
          return {
            result: {
              retval: xdr.ScVal.scvVec(opts.versions.map((v) => xdr.ScVal.scvString(v))),
            },
          };
        }
        if (fnName === "get_version") {
          const args = invocation.args();
          const version = (args[2] as xdr.ScVal).str().toString();
          const retval = opts.records[version];
          return { result: { retval: retval ?? xdr.ScVal.scvVoid() } };
        }
        throw new Error(`unexpected function in test: ${fnName}`);
      },
    );
}

function makeClient(
  overrides: Partial<ConstructorParameters<typeof OnChainAbiRegistryClient>[0]> = {},
) {
  return new OnChainAbiRegistryClient({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    publisher: PUBLISHER_ADDRESS,
    ...overrides,
  });
}

describe("OnChainAbiRegistryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no versions have been published for a contract", async () => {
    installMockServer(routingSimulate({ versions: [], records: {} }));
    const client = makeClient();

    expect(await client.getSpec(TARGET_CONTRACT_ID)).toBeNull();
  });

  it("resolves the latest published spec, verifying the blob's hash against the on-chain spec_hash", async () => {
    const spec = testSpec({ version: "2.0.0" });
    const blob = JSON.stringify(spec);
    const specHash = createHash("sha256").update(blob).digest();

    installMockServer(
      routingSimulate({
        versions: ["1.0.0", "2.0.0"],
        records: {
          "1.0.0": specRecordScVal({
            version: "1.0.0",
            specHash: createHash("sha256").update("old").digest(),
            pointer: "https://example.com/old.json",
            publisher: PUBLISHER_ADDRESS,
            publishedAtLedger: 100,
          }),
          "2.0.0": specRecordScVal({
            version: "2.0.0",
            specHash,
            pointer: "https://example.com/spec.json",
            publisher: PUBLISHER_ADDRESS,
            publishedAtLedger: 200,
          }),
        },
      }),
    );

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => blob,
    });
    const client = makeClient({ transport: transport as unknown as typeof fetch });

    const resolved = await client.getSpec(TARGET_CONTRACT_ID);
    expect(resolved).toEqual(spec);
    expect(transport).toHaveBeenCalledWith("https://example.com/spec.json");
  });

  it("throws when the fetched blob's hash does not match the on-chain spec_hash", async () => {
    const spec = testSpec();
    const blob = JSON.stringify(spec);
    const wrongHash = createHash("sha256").update("tampered").digest();

    installMockServer(
      routingSimulate({
        versions: ["1.0.0"],
        records: {
          "1.0.0": specRecordScVal({
            version: "1.0.0",
            specHash: wrongHash,
            pointer: "https://example.com/spec.json",
            publisher: PUBLISHER_ADDRESS,
          }),
        },
      }),
    );
    const transport = vi.fn().mockResolvedValue({ ok: true, text: async () => blob });
    const client = makeClient({ transport: transport as unknown as typeof fetch });

    await expect(client.getSpec(TARGET_CONTRACT_ID)).rejects.toThrow(/spec_hash mismatch/);
  });

  it("getSpecAt resolves the version whose published_at_ledger is <= the requested ledger", async () => {
    const specV1 = testSpec({ version: "1.0.0" });
    const specV2 = testSpec({ version: "2.0.0" });
    const blobV1 = JSON.stringify(specV1);
    const blobV2 = JSON.stringify(specV2);

    installMockServer(
      routingSimulate({
        versions: ["1.0.0", "2.0.0"],
        records: {
          "1.0.0": specRecordScVal({
            version: "1.0.0",
            specHash: createHash("sha256").update(blobV1).digest(),
            pointer: "https://example.com/v1.json",
            publisher: PUBLISHER_ADDRESS,
            publishedAtLedger: 100,
          }),
          "2.0.0": specRecordScVal({
            version: "2.0.0",
            specHash: createHash("sha256").update(blobV2).digest(),
            pointer: "https://example.com/v2.json",
            publisher: PUBLISHER_ADDRESS,
            publishedAtLedger: 200,
          }),
        },
      }),
    );
    const transport = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () => (url.includes("v1") ? blobV1 : blobV2),
    }));
    const client = makeClient({ transport: transport as unknown as typeof fetch });

    expect(await client.getSpecAt(TARGET_CONTRACT_ID, 150)).toEqual(specV1);
    expect(await client.getSpecAt(TARGET_CONTRACT_ID, 250)).toEqual(specV2);
    expect(await client.getSpecAt(TARGET_CONTRACT_ID, 50)).toBeNull();
  });

  it("clears cached records and specs so a subsequent lookup re-reads the chain", async () => {
    const spec = testSpec();
    const blob = JSON.stringify(spec);
    const simulate = routingSimulate({
      versions: ["1.0.0"],
      records: {
        "1.0.0": specRecordScVal({
          version: "1.0.0",
          specHash: createHash("sha256").update(blob).digest(),
          pointer: "https://example.com/spec.json",
          publisher: PUBLISHER_ADDRESS,
        }),
      },
    });
    installMockServer(simulate);
    const transport = vi.fn().mockResolvedValue({ ok: true, text: async () => blob });
    const client = makeClient({ transport: transport as unknown as typeof fetch });

    await client.getSpec(TARGET_CONTRACT_ID);
    client.clearCache();
    await client.getSpec(TARGET_CONTRACT_ID);

    expect(simulate).toHaveBeenCalledTimes(4); // list_versions + get_version, twice total
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("caches resolved specs - a second getSpec call does not re-simulate", async () => {
    const spec = testSpec();
    const blob = JSON.stringify(spec);
    const simulate = routingSimulate({
      versions: ["1.0.0"],
      records: {
        "1.0.0": specRecordScVal({
          version: "1.0.0",
          specHash: createHash("sha256").update(blob).digest(),
          pointer: "https://example.com/spec.json",
          publisher: PUBLISHER_ADDRESS,
        }),
      },
    });
    installMockServer(simulate);
    const transport = vi.fn().mockResolvedValue({ ok: true, text: async () => blob });
    const client = makeClient({ transport: transport as unknown as typeof fetch });

    await client.getSpec(TARGET_CONTRACT_ID);
    await client.getSpec(TARGET_CONTRACT_ID);

    expect(simulate).toHaveBeenCalledTimes(2); // list_versions + get_version, once total
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
