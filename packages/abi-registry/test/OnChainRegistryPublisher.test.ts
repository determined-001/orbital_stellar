import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Account, Keypair, Networks, rpc as SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { OnChainRegistryPublisher } from "../src/OnChainRegistryPublisher.js";
import type {
  OfferingPublishParams,
  OperatorPublishParams,
} from "../src/OnChainRegistryPublisher.js";
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

function validOperatorParams(
  overrides: Partial<OperatorPublishParams> = {},
): OperatorPublishParams {
  return {
    version: "1.0.0",
    displayName: "Test Operator",
    contact: "ops@example.com",
    triggerClasses: ["price-oracle"],
    networks: ["testnet"],
    price: 100,
    denomination: "XLM",
    latencyTier: "standard",
    pointer: "https://example.com/operators/test.json",
    ...overrides,
  };
}

function validOfferingParams(
  overrides: Partial<OfferingPublishParams> = {},
): OfferingPublishParams {
  return {
    version: "1.0.0",
    targetContract: REGISTRY_CONTRACT_ID,
    functionName: "update_price",
    triggerClass: "price-oracle",
    price: 250,
    denomination: "XLM",
    pointer: "https://example.com/offerings/test.json",
    ...overrides,
  };
}

/** Extracts the invoked contract function name + decoded args from the mocked prepared tx. */
function invokedCall(server: MockServer): { functionName: string; args: unknown[] } {
  const preparedTx = server.prepareTransaction.mock.calls[0]![0];
  const op = preparedTx.operations[0];
  expect(op.func.switch().name).toBe("hostFunctionTypeInvokeContract");
  const invocation = op.func.invokeContract();
  return {
    functionName: invocation.functionName().toString(),
    args: invocation.args().map((arg: Parameters<typeof scValToNative>[0]) => scValToNative(arg)),
  };
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

  it("registerOperator: requires version, displayName and pointer without touching the network", async () => {
    installMockServer();
    const publisher = makePublisher();

    await expect(publisher.registerOperator(validOperatorParams({ version: "" }))).rejects.toThrow(
      /version is required/,
    );
    await expect(
      publisher.registerOperator(validOperatorParams({ displayName: "" })),
    ).rejects.toThrow(/displayName is required/);
    await expect(publisher.registerOperator(validOperatorParams({ pointer: "" }))).rejects.toThrow(
      /pointer is required/,
    );
    expect(SorobanRpc.Server).not.toHaveBeenCalled();
  });

  it("registerOperator: publishes successfully and returns operator-scoped PublishResult", async () => {
    const server = installMockServer();
    const operator = Keypair.random().publicKey();
    const publisher = makePublisher();
    const params = validOperatorParams({ operatorAddress: operator });

    const result = await publisher.registerOperator(params);

    expect(result).toEqual({
      contractId: operator,
      version: params.version,
      etag: params.pointer,
      txHash: "deadbeef",
    });
    expect(server.getAccount).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("registerOperator: invokes register_operator with 10 arguments in contract order", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    await publisher.registerOperator(validOperatorParams());

    const { functionName, args } = invokedCall(server);
    expect(functionName).toBe("register_operator");
    expect(args).toHaveLength(10);
  });

  it("registerOperator: marshals explicit fields including i128 price and vec fields", async () => {
    const server = installMockServer();
    const operator = Keypair.random().publicKey();
    const publisher = makePublisher();
    const params = validOperatorParams({
      operatorAddress: operator,
      version: "2.0.0",
      displayName: "Oracle Ops",
      contact: "oracle@example.com",
      triggerClasses: ["price-oracle", "event-trigger"],
      networks: ["testnet", "mainnet"],
      price: 1500,
      denomination: "USDC",
      latencyTier: "low",
      pointer: "https://example.com/operators/oracle.json",
    });

    await publisher.registerOperator(params);

    const { args } = invokedCall(server);
    expect(args[0]).toBe(operator);
    expect(args[1]).toBe("2.0.0");
    expect(args[2]).toBe("Oracle Ops");
    expect(args[3]).toBe("oracle@example.com");
    expect(args[4]).toEqual(["price-oracle", "event-trigger"]);
    expect(args[5]).toEqual(["testnet", "mainnet"]);
    // i128 price must survive as bigint — a silent number/string change breaks the contract shape.
    expect(args[6]).toBe(1500n);
    expect(args[7]).toBe("USDC");
    expect(args[8]).toBe("low");
    expect(args[9]).toBe("https://example.com/operators/oracle.json");
  });

  it("registerOperator: applies defaults for omitted optional fields", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const {
      contact: _c,
      triggerClasses: _t,
      networks: _n,
      price: _p,
      ...minimal
    } = validOperatorParams();
    const { denomination: _d, latencyTier: _l, ...noDefaults } = minimal;

    await publisher.registerOperator(noDefaults);

    const { args } = invokedCall(server);
    expect(args[3]).toBe("");
    expect(args[4]).toEqual([]);
    expect(args[5]).toEqual([]);
    expect(args[6]).toBe(0n);
    expect(args[7]).toBe("XLM");
    expect(args[8]).toBe("standard");
  });

  it("registerOperator: accepts bigint price without coercion loss", async () => {
    const server = installMockServer();
    const publisher = makePublisher();

    await publisher.registerOperator(validOperatorParams({ price: 9007199254740993n }));

    const { args } = invokedCall(server);
    expect(args[6]).toBe(9007199254740993n);
  });

  it("registerOperator: throws when sendTransaction reports ERROR and when confirmation fails", async () => {
    installMockServer({
      sendTransaction: vi.fn().mockResolvedValue({ status: "ERROR", errorResult: "boom" }),
    });
    await expect(makePublisher().registerOperator(validOperatorParams())).rejects.toThrow(
      /sendTransaction failed/,
    );

    vi.clearAllMocks();
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.FAILED }),
    });
    await expect(makePublisher().registerOperator(validOperatorParams())).rejects.toThrow(
      /transaction failed with status/,
    );

    vi.clearAllMocks();
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND }),
    });
    await expect(
      makePublisher({ pollIntervalMs: 5, pollTimeoutMs: 30 }).registerOperator(
        validOperatorParams(),
      ),
    ).rejects.toThrow(/not confirmed within/);
  });

  it("publishOperator: aliases registerOperator", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const params = validOperatorParams();

    const result = await publisher.publishOperator(params);

    expect(result.version).toBe(params.version);
    expect(result.etag).toBe(params.pointer);
    const { functionName } = invokedCall(server);
    expect(functionName).toBe("register_operator");
  });

  it("registerOffering: requires version, targetContract, triggerClass and pointer", async () => {
    installMockServer();
    const publisher = makePublisher();

    await expect(publisher.registerOffering(validOfferingParams({ version: "" }))).rejects.toThrow(
      /version is required/,
    );
    await expect(
      publisher.registerOffering(validOfferingParams({ targetContract: "" })),
    ).rejects.toThrow(/targetContract is required/);
    await expect(
      publisher.registerOffering(validOfferingParams({ triggerClass: "" })),
    ).rejects.toThrow(/triggerClass is required/);
    await expect(publisher.registerOffering(validOfferingParams({ pointer: "" }))).rejects.toThrow(
      /pointer is required/,
    );
    expect(SorobanRpc.Server).not.toHaveBeenCalled();
  });

  it("registerOffering: publishes successfully and returns target-scoped PublishResult", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const params = validOfferingParams();

    const result = await publisher.registerOffering(params);

    expect(result).toEqual({
      contractId: params.targetContract,
      version: params.version,
      etag: params.pointer,
      txHash: "deadbeef",
    });
    expect(server.getAccount).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("registerOffering: invokes register_offering with 8 arguments in contract order", async () => {
    const server = installMockServer();
    const operator = Keypair.random().publicKey();
    const publisher = makePublisher();
    const params = validOfferingParams({
      operatorAddress: operator,
      version: "3.1.0",
      functionName: "update_price",
      triggerClass: "price-oracle",
      price: 275,
      denomination: "XLM",
      pointer: "https://example.com/offerings/oracle.json",
    });

    await publisher.registerOffering(params);

    const { functionName, args } = invokedCall(server);
    expect(functionName).toBe("register_offering");
    expect(args).toHaveLength(8);
    expect(args[0]).toBe(operator);
    expect(args[1]).toBe("3.1.0");
    expect(args[2]).toBe(params.targetContract);
    expect(args[3]).toBe("update_price");
    expect(args[4]).toBe("price-oracle");
    expect(args[5]).toBe(275n);
    expect(args[6]).toBe("XLM");
    expect(args[7]).toBe("https://example.com/offerings/oracle.json");
  });

  it("registerOffering: applies price/denomination defaults", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const { price: _p, denomination: _d, ...minimal } = validOfferingParams();

    await publisher.registerOffering(minimal);

    const { args } = invokedCall(server);
    expect(args[5]).toBe(0n);
    expect(args[6]).toBe("XLM");
  });

  it("registerOffering: throws when sendTransaction reports ERROR and when confirmation fails", async () => {
    installMockServer({
      sendTransaction: vi.fn().mockResolvedValue({ status: "ERROR", errorResult: "boom" }),
    });
    await expect(makePublisher().registerOffering(validOfferingParams())).rejects.toThrow(
      /sendTransaction failed/,
    );

    vi.clearAllMocks();
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.FAILED }),
    });
    await expect(makePublisher().registerOffering(validOfferingParams())).rejects.toThrow(
      /transaction failed with status/,
    );

    vi.clearAllMocks();
    installMockServer({
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND }),
    });
    await expect(
      makePublisher({ pollIntervalMs: 5, pollTimeoutMs: 30 }).registerOffering(
        validOfferingParams(),
      ),
    ).rejects.toThrow(/not confirmed within/);
  });

  it("publishOffering: aliases registerOffering", async () => {
    const server = installMockServer();
    const publisher = makePublisher();
    const params = validOfferingParams();

    const result = await publisher.publishOffering(params);

    expect(result.contractId).toBe(params.targetContract);
    const { functionName } = invokedCall(server);
    expect(functionName).toBe("register_offering");
  });
});
