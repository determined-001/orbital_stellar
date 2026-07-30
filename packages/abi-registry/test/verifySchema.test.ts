import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { verifySchema } from "../src/verifySchema.js";
import type { ContractSpec } from "../src/spec.js";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: vi.fn() },
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_EMITTER_FIXTURE = resolve(__dirname, "fixtures/demo-emitter.wasm");
const REGISTRY_FIXTURE = resolve(__dirname, "fixtures/registry.wasm");
const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

function installMockServer(getContractWasmByContractId: ReturnType<typeof vi.fn>) {
  const server = { getContractWasmByContractId };
  (SorobanRpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (
    this: unknown,
  ) {
    return server;
  });
}

// Helper to get a sample spec from demo-emitter
function getDemoEmitterSpec(): ContractSpec {
  return {
    version: "1.0.0",
    name: "demo-emitter",
    contractId: CONTRACT_ID,
    network: "testnet",
    functions: [
      {
        name: "ping",
        params: [],
        returns: "u32",
      },
    ],
    events: [
      {
        name: "Ping",
        topics: [
          {
            name: "event_name",
            type: "symbol",
            doc: 'Fixed prefix topic, always "Ping".',
          },
          {
            name: "count",
            type: "u32",
          },
        ],
        data: [
          {
            name: "timestamp",
            type: "u64",
          },
        ],
      },
    ],
    types: {},
  };
}

describe("verifySchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("match verdict", () => {
    it("returns match when submitted schema exactly matches on-chain spec", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      // Get the actual spec from the on-chain contract
      const submittedSchema = getDemoEmitterSpec();

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("match");
      expect(verdict).toEqual({ status: "match" });
    });

    it("returns match even when optional doc fields differ (only structure matters)", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            doc: "This is a different doc",
            params: [],
            returns: "u32",
          },
        ],
        events: [
          {
            name: "Ping",
            doc: "Custom documentation",
            topics: [
              {
                name: "event_name",
                type: "symbol",
                doc: "Custom prefix topic doc",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [
              {
                name: "timestamp",
                type: "u64",
              },
            ],
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("match");
    });
  });

  describe("mismatch verdict", () => {
    it("returns mismatch with diffs when function signature differs", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [{ name: "extra_param", type: "u32" }], // Extra parameter not in on-chain
            returns: "u32",
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [
              {
                name: "timestamp",
                type: "u64",
              },
            ],
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        expect(verdict.diffs.some((d) => d.path.includes("ping"))).toBe(true);
        expect(verdict.diffs.some((d) => d.path.includes("params"))).toBe(true);
      }
    });

    it("returns mismatch when event data differs", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [],
            returns: "u32",
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [{ name: "extra_field", type: "u32" }], // Extra field not in on-chain
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        expect(verdict.diffs.some((d) => d.path.includes("Ping"))).toBe(true);
      }
    });

    it("returns mismatch when return type differs", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [],
            returns: "void", // Wrong return type - should be u32
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [
              {
                name: "timestamp",
                type: "u64",
              },
            ],
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        expect(verdict.diffs.some((d) => d.path.includes("returns"))).toBe(true);
      }
    });

    it("reports multiple diffs when multiple fields differ", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [{ name: "wrong_param", type: "string" }],
            returns: "u32",
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "wrong_topic",
                type: "u64",
              },
            ],
            data: [],
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("detects missing functions in submitted schema", async () => {
      const wasmBinary = readFileSync(REGISTRY_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "registry",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          // Only submit one function, omit the others
          {
            name: "publish",
            params: [
              { name: "publisher", type: "address" },
              { name: "contract_id", type: "address" },
              { name: "version", type: "string" },
              {
                name: "spec_hash",
                type: {
                  type: "bytes_n",
                  size: 32,
                },
              },
              { name: "pointer", type: "string" },
            ],
            returns: {
              type: "result",
              ok: "void",
              err: "error",
            },
          },
        ],
        events: [],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        // Should have diffs indicating missing functions
        expect(
          verdict.diffs.some(
            (d) =>
              d.path.includes("latest") ||
              d.path.includes("get_version") ||
              d.path.includes("list_versions") ||
              d.path.includes("list_versions_paged"),
          ),
        ).toBe(true);
      }
    });

    it("detects extra functions in submitted schema", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [],
            returns: "u32",
          },
          {
            name: "extra_function",
            params: [],
            returns: "void",
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [
              {
                name: "timestamp",
                type: "u64",
              },
            ],
          },
        ],
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        expect(verdict.diffs.some((d) => d.path.includes("extra_function"))).toBe(true);
      }
    });

    it("detects missing events in submitted schema", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "ping",
            params: [],
            returns: "u32",
          },
        ],
        events: [], // Missing the Ping event
        types: {},
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
        expect(verdict.diffs.some((d) => d.path.includes("Ping"))).toBe(true);
      }
    });
  });

  describe("unverifiable verdict", () => {
    it("returns unverifiable when contract has no embedded spec", async () => {
      const emptyWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      installMockServer(vi.fn().mockResolvedValue(emptyWasm));

      const submittedSchema = getDemoEmitterSpec();

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("unverifiable");
      if (verdict.status === "unverifiable") {
        expect(verdict.reason).toContain("embedded");
      }
    });

    it("returns unverifiable for SAC contracts (WASM fetch failure)", async () => {
      installMockServer(vi.fn().mockRejectedValue(new Error("contract not found")));

      const submittedSchema = getDemoEmitterSpec();

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("unverifiable");
      if (verdict.status === "unverifiable") {
        expect(verdict.reason).toContain("embedded");
      }
    });

    it("includes helpful reason message", async () => {
      const emptyWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      installMockServer(vi.fn().mockResolvedValue(emptyWasm));

      const submittedSchema = getDemoEmitterSpec();

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
      });

      expect(verdict.status).toBe("unverifiable");
      if (verdict.status === "unverifiable") {
        expect(verdict.reason.length).toBeGreaterThan(0);
        expect(verdict.reason).toMatch(/SEP-48|non-WASM|embedded/i);
      }
    });
  });

  describe("error handling", () => {
    it("throws non-NoEmbeddedSpecError exceptions from discovery", async () => {
      // Create a custom error that is NOT NoEmbeddedSpecError
      const rpcError = new Error("RPC connection failed");
      rpcError.name = "SomeRpcError"; // Make it obviously not NoEmbeddedSpecError
      installMockServer(vi.fn().mockRejectedValue(rpcError));

      const submittedSchema = getDemoEmitterSpec();

      await expect(
        verifySchema(CONTRACT_ID, submittedSchema, {
          rpcUrl: "https://invalid-rpc.example.com",
        }),
      ).rejects.toThrow("RPC connection failed");
    });

    it("handles network parameter correctly in discovery options", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema = getDemoEmitterSpec();

      // Verify with network specified
      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("match");
    });

    it("handles network parameter as optional", async () => {
      const wasmBinary = readFileSync(DEMO_EMITTER_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "demo-emitter",
        contractId: CONTRACT_ID,
        functions: [
          {
            name: "ping",
            params: [],
            returns: "u32",
          },
        ],
        events: [
          {
            name: "Ping",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "count",
                type: "u32",
              },
            ],
            data: [
              {
                name: "timestamp",
                type: "u64",
              },
            ],
          },
        ],
        types: {},
      };

      // Verify without network specified
      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
      });

      expect(verdict.status).toBe("match");
    });
  });

  describe("complex type comparisons", () => {
    it("correctly compares complex nested types", async () => {
      const wasmBinary = readFileSync(REGISTRY_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "registry",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "publish",
            params: [
              { name: "publisher", type: "address" },
              { name: "contract_id", type: "address" },
              { name: "version", type: "string" },
              {
                name: "spec_hash",
                type: {
                  type: "bytes_n",
                  size: 32,
                },
              },
              { name: "pointer", type: "string" },
            ],
            returns: {
              type: "result",
              ok: "void",
              err: "error",
            },
          },
          {
            name: "latest",
            params: [
              { name: "contract_id", type: "address" },
              { name: "publisher", type: "address" },
            ],
            returns: {
              type: "option",
              inner: { type: "named", name: "SpecRecord" },
            },
          },
          {
            name: "list_versions",
            params: [
              { name: "contract_id", type: "address" },
              { name: "publisher", type: "address" },
            ],
            returns: {
              type: "vec",
              item: "string",
            },
          },
          {
            name: "list_versions_paged",
            params: [
              { name: "contract_id", type: "address" },
              { name: "publisher", type: "address" },
              { name: "start", type: "u32" },
              { name: "limit", type: "u32" },
            ],
            returns: {
              type: "tuple",
              elements: [
                { type: "vec", item: "string" },
                { type: "option", inner: "u32" },
              ],
            },
          },
          {
            name: "get_version",
            params: [
              { name: "contract_id", type: "address" },
              { name: "publisher", type: "address" },
              { name: "version", type: "string" },
            ],
            returns: {
              type: "option",
              inner: { type: "named", name: "SpecRecord" },
            },
          },
        ],
        events: [
          {
            name: "SpecPublished",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "contract_id",
                type: "address",
              },
              {
                name: "version",
                type: "string",
              },
            ],
            data: [
              {
                name: "spec_hash",
                type: { type: "bytes_n", size: 32 },
              },
              {
                name: "pointer",
                type: "string",
              },
              {
                name: "publisher",
                type: "address",
              },
            ],
          },
        ],
        types: {
          SpecRecord: {
            kind: "struct",
            name: "SpecRecord",
            fields: [
              { name: "pointer", type: "string" },
              { name: "published_at", type: "u64" },
              { name: "published_at_ledger", type: "u32" },
              { name: "publisher", type: "address" },
              { name: "spec_hash", type: { type: "bytes_n", size: 32 } },
              { name: "version", type: "string" },
            ],
          },
          Error: {
            kind: "enum",
            name: "Error",
            variants: [
              {
                name: "AlreadyPublished",
                doc: "A spec for this (contract_id, publisher, version) already exists.\nSpecs are immutable per version - republish under a new version instead.",
                discriminant: 1,
              },
              { name: "EmptyVersion", discriminant: 2 },
              { name: "EmptyPointer", discriminant: 3 },
              {
                name: "StartPastEnd",
                doc: "The requested start cursor exceeds the total number of versions.",
                discriminant: 4,
              },
              {
                name: "LimitExceedsMax",
                doc: "The requested page limit exceeds MAX_PAGE_SIZE.",
                discriminant: 5,
              },
            ],
          },
        },
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("match");
    });

    it("detects differences in nested complex types", async () => {
      const wasmBinary = readFileSync(REGISTRY_FIXTURE);
      installMockServer(vi.fn().mockResolvedValue(wasmBinary));

      const submittedSchema: ContractSpec = {
        version: "1.0.0",
        name: "registry",
        contractId: CONTRACT_ID,
        network: "testnet",
        functions: [
          {
            name: "publish",
            params: [
              { name: "publisher", type: "address" },
              { name: "contract_id", type: "address" },
              { name: "version", type: "string" },
              {
                name: "spec_hash",
                type: {
                  type: "bytes_n",
                  size: 32,
                },
              },
              { name: "pointer", type: "string" },
            ],
            returns: {
              type: "result",
              ok: "void",
              err: "error",
            },
          },
          {
            name: "latest",
            params: [{ name: "contract_id", type: "address" }],
            returns: {
              type: "option",
              inner: { type: "named", name: "SpecRecord" },
            },
          },
          {
            name: "list_versions",
            params: [{ name: "contract_id", type: "address" }],
            returns: {
              type: "vec",
              item: "u32", // Wrong item type - should be "string"
            },
          },
          {
            name: "get_version",
            params: [
              { name: "contract_id", type: "address" },
              { name: "version", type: "string" },
            ],
            returns: {
              type: "option",
              inner: { type: "named", name: "SpecRecord" },
            },
          },
        ],
        events: [
          {
            name: "SpecPublished",
            topics: [
              {
                name: "event_name",
                type: "symbol",
              },
              {
                name: "contract_id",
                type: "address",
              },
              {
                name: "version",
                type: "string",
              },
            ],
            data: [
              {
                name: "spec_hash",
                type: { type: "bytes_n", size: 32 },
              },
              {
                name: "pointer",
                type: "string",
              },
              {
                name: "publisher",
                type: "address",
              },
            ],
          },
        ],
        types: {
          SpecRecord: {
            kind: "struct",
            name: "SpecRecord",
            fields: [
              { name: "spec_hash", type: { type: "bytes_n", size: 32 } },
              { name: "pointer", type: "string" },
              { name: "publisher", type: "address" },
            ],
          },
          Error: {
            kind: "enum",
            name: "Error",
            variants: [
              { name: "AlreadyPublished", discriminant: 0 },
              { name: "EmptyVersion", discriminant: 1 },
              { name: "EmptyPointer", discriminant: 2 },
            ],
          },
        },
      };

      const verdict = await verifySchema(CONTRACT_ID, submittedSchema, {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
      });

      expect(verdict.status).toBe("mismatch");
      if (verdict.status === "mismatch") {
        expect(verdict.diffs.length).toBeGreaterThan(0);
      }
    });
  });
});
