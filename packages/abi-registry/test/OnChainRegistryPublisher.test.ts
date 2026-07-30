import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Account, Keypair, Networks, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { OnChainRegistryPublisher } from "../src/OnChainRegistryPublisher.js";
import { canonicalizeSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: vi.fn() },
  };
});

const REGISTRY_CONTRACT_ID = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";

function validSpec(overrides: Partial<ContractSpec> = {}): ContractSpec {
  return {
    version: "1.0.0",
    name: "Test Token",
    contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    network: "mainnet",
    functions: [],
    events: [],
    types: {},
    pointer: "https://example.com/specs/test-token.json",
    ...overrides,
  };
}

type MockServer = {
  getAccount: ReturnType<typeof vi.fn>;
  prepareTransaction: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
};

function installMockServer(overrides: Partial<MockServer> = {}): MockServer {
  const keypair = Keypair.random();
  const server: MockServer = {
    getAccount: vi.fn().mockResolvedValue(new Account(keypair.publicKey(), "100")),
    prepareTransaction: vi.fn().mockImplementation(async (tx) => tx),
    sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: "deadbeef" }),
    getTransaction: vi
      .fn()
      .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.SUCCESS, ledger: 999 }),
    ...overrides,
  };
  (SorobanRpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function (
    this: unknown,
  ) {
    return server;
  });
  return server;
}

function makePublisher(
  overrides: Partial<ConstructorParameters<typeof OnChainRegistryPublisher>[0]> = {},
) {
  return new OnChainRegistryPublisher({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    publisherSecret: Keypair.random().secret(),
    pollIntervalMs: 5,
    pollTimeoutMs: 200,
    ...overrides,
  });
}

describe("OnChainRegistryPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid spec without touching the network", async () => {
    installMockServer();
    const publisher = makePublisher();

    await expect(publisher.publish({ not: "a spec" })).rejects.toThrow(/validation failed/);
    expect(SorobanRpc.Server).not.toHaveBeenCalled();
  });

  it("requires spec.contractId", async () => {
    installMockServer();
    const publisher = makePublisher();
    const { contractId: _omit, ...spec } = validSpec();

    await expect(publisher.publish(spec)).rejects.toThrow(/contractId is required/);
  });

  it("requires spec.pointer", async () => {
    installMockServer();
    const publisher = makePublisher();
    const { pointer: _omit, ...spec } = validSpec();

    await expect(publisher.publish(spec)).rejects.toThrow(/pointer is required/);
  });

  it("publishes successfully and returns an etag equal to sha256(canonicalizeSpec(spec))", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const spec = validSpec();

    const result = await publisher.publish(spec);

    const expectedHash = createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");
    expect(result).toEqual({
      contractId: spec.contractId,
      version: spec.version,
      etag: expectedHash,
      txHash: "deadbeef",
    });
    expect(server.getAccount).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("invokes the registry contract's publish function with 5 arguments", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    await publisher.publish(validSpec());

    const preparedTx = server.prepareTransaction.mock.calls[0]![0];
    const op = preparedTx.operations[0];
    expect(op.func.switch().name).toBe("hostFunctionTypeInvokeContract");
    const invocation = op.func.invokeContract();
    expect(invocation.functionName().toString()).toBe("publish");
    expect(invocation.args()).toHaveLength(5);
  });

  it("throws when sendTransaction reports an ERROR status", async () => {
    installMockServer({
      sendTransaction: vi.fn().mockResolvedValue({ status: "ERROR", errorResult: "boom" }),
    });
    const publisher = makePublisher();

    await expect(publisher.publish(validSpec())).rejects.toThrow(/sendTransaction failed/);
  });

  it("throws when the confirmed transaction failed", async () => {
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.FAILED }),
    });
    const publisher = makePublisher();

    await expect(publisher.publish(validSpec())).rejects.toThrow(/transaction failed with status/);
  });

  it("throws when the transaction is never confirmed before the poll timeout", async () => {
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND }),
    });
    const publisher = makePublisher({ pollIntervalMs: 5, pollTimeoutMs: 30 });

    await expect(publisher.publish(validSpec())).rejects.toThrow(/not confirmed within/);
  });
});
