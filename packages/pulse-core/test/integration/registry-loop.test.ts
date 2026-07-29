import { createHash } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  nativeToScVal,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import { createDefaultAbiRegistryClient } from "@orbital-stellar/abi-registry";
import { EventEngine } from "../../src/EventEngine.js";
import type { ContractEmittedEvent } from "../../src/index.js";

const shouldRun = process.env.INTEGRATION_TESTS === "true";

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const REGISTRY_CONTRACT_ID =
  process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID ??
  process.env.SOROBAN_REGISTRY_CONTRACT_ID ??
  "";
const REGISTRY_PUBLISHER_SECRET =
  process.env.ORBITAL_REGISTRY_PUBLISHER_SECRET ?? process.env.SOROBAN_INVOKER_SECRET ?? "";
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID ?? "";
const INVOKER_SECRET = process.env.SOROBAN_INVOKER_SECRET ?? "";
const CONTRACT_FN = process.env.SOROBAN_CONTRACT_FN ?? "ping";

const hasConfig = Boolean(
  REGISTRY_CONTRACT_ID && REGISTRY_PUBLISHER_SECRET && CONTRACT_ID && INVOKER_SECRET,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  predicate: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value !== undefined) return value;
    await sleep(1000);
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

async function publishDemoEmitterSpec(opts: {
  rpcUrl: string;
  registryContractId: string;
  publisherSecret: string;
  contractId: string;
  version: string;
}): Promise<void> {
  const { rpcUrl, registryContractId, publisherSecret, contractId, version } = opts;
  const server = new SorobanRpc.Server(rpcUrl);
  const publisher = Keypair.fromSecret(publisherSecret);
  const source = await server.getAccount(publisher.publicKey());
  const contract = new Contract(registryContractId);

  const spec = {
    version: "1.0.0",
    name: "demo-emitter",
    contractId,
    network: "testnet",
    functions: [{ name: "ping", params: [], returns: "u32" }],
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
        data: [{ name: "timestamp", type: "u64" }],
      },
    ],
    types: {},
  };

  const blob = JSON.stringify(spec);
  const specHash = createHash("sha256").update(blob).digest();
  const pointer = `data:application/json;base64,${Buffer.from(blob).toString("base64")}`;

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "publish",
        nativeToScVal(publisher.publicKey(), { type: "address" }),
        nativeToScVal(contractId, { type: "address" }),
        nativeToScVal(version, { type: "string" }),
        nativeToScVal(Buffer.from(specHash), { type: "bytes" }),
        nativeToScVal(pointer, { type: "string" }),
      ),
    )
    .setTimeout(60)
    .build();

  try {
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(publisher);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(`sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
    }

    for (let i = 0; i < 30; i++) {
      const result = await server.getTransaction(sent.hash);
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          throw new Error(`publish transaction failed with status ${result.status}`);
        }
        return;
      }
      await sleep(1000);
    }
    throw new Error("publish transaction not confirmed within 30s");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to publish the ABI spec to the on-chain registry: ${message}. This usually indicates the registry or publisher account was reset on testnet; re-provision the registry contract and secrets before re-running this integration test.`,
    );
  }
}

async function invokeContract(opts: {
  rpcUrl: string;
  contractId: string;
  invokerSecret: string;
  contractFn: string;
}): Promise<{ txHash: string; ledger: number }> {
  const { rpcUrl, contractId, invokerSecret, contractFn } = opts;
  const server = new SorobanRpc.Server(rpcUrl);
  const keypair = Keypair.fromSecret(invokerSecret);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(contractFn))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
  }

  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`transaction failed with status ${result.status}`);
      }
      return { txHash: sent.hash, ledger: result.ledger };
    }
    await sleep(1000);
  }
  throw new Error("transaction not confirmed within 30s");
}

describe.runIf(shouldRun)("ABI registry integration loop", () => {
  let engine: EventEngine | undefined;

  afterEach(async () => {
    await engine?.stop();
    engine = undefined;
  });

  it.runIf(hasConfig)(
    "publishes a spec, subscribes to the contract, and receives decodedData from the live on-chain registry",
    async () => {
      const registry = createDefaultAbiRegistryClient();
      registry.clearCache?.();

      await publishDemoEmitterSpec({
        rpcUrl: RPC_URL,
        registryContractId: REGISTRY_CONTRACT_ID,
        publisherSecret: REGISTRY_PUBLISHER_SECRET,
        contractId: CONTRACT_ID,
        version: `it-${Date.now()}`,
      });

      const spec = await waitFor(async () => {
        const resolved = await registry.getSpec(CONTRACT_ID);
        return resolved ?? undefined;
      }, 60_000);

      expect(spec).not.toBeNull();
      expect((spec as { name?: string } | null)?.name).toBe("demo-emitter");
      expect((spec as { events?: Array<{ name: string }> } | null)?.events?.[0]?.name).toBe("Ping");

      const received: ContractEmittedEvent[] = [];
      engine = new EventEngine({
        network: "testnet",
        soroban: { rpcUrl: RPC_URL },
        abiRegistry: registry,
      });

      const watcher = engine.subscribeContract(CONTRACT_ID, {
        filters: [{ contractIds: [CONTRACT_ID] }],
      });
      watcher.on("contract.emitted", (event) => {
        const emitted = event as ContractEmittedEvent;
        if (emitted.contractId === CONTRACT_ID) received.push(emitted);
      });

      engine.start();
      await engine
        .awaitContractSubscriptionActive({ contractId: CONTRACT_ID }, { timeoutMs: 20_000 })
        .catch(() => {
          /* best-effort - fall through to the event wait below */
        });

      const { txHash, ledger } = await invokeContract({
        rpcUrl: RPC_URL,
        contractId: CONTRACT_ID,
        invokerSecret: INVOKER_SECRET,
        contractFn: CONTRACT_FN,
      });

      const event = await waitFor(
        () =>
          received.find((candidate) =>
            candidate.txHash ? candidate.txHash === txHash : (candidate.ledger ?? 0) >= ledger,
          ),
        90_000,
      );

      expect(event.type).toBe("contract.emitted");
      expect(event.contractId).toBe(CONTRACT_ID);
      expect(event.decodedData).toBeDefined();
      expect(typeof event.decodedData).toBe("object");
      expect(event.decodedData).not.toBeNull();
    },
    300_000,
  );

  it.skipIf(hasConfig)(
    "skips the live registry loop when the required environment variables are unset",
    () => {
      console.warn(
        "[registry-loop integration] live test skipped - set ORBITAL_REGISTRY_TESTNET_CONTRACT_ID (or SOROBAN_REGISTRY_CONTRACT_ID), ORBITAL_REGISTRY_PUBLISHER_SECRET (or SOROBAN_INVOKER_SECRET), SOROBAN_CONTRACT_ID and SOROBAN_INVOKER_SECRET to run the live registry loop.",
      );
      expect(hasConfig).toBe(false);
    },
  );
});

describe.skipIf(shouldRun)("ABI registry integration loop (gated)", () => {
  it("skips unless INTEGRATION_TESTS=true", () => {
    expect(shouldRun).toBe(false);
  });
});
