import { describe, it, expect, afterEach } from "vitest";
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import { EventEngine } from "../../src/EventEngine.js";
import type { ContractEmittedEvent } from "../../src/index.js";

// ── Gating ────────────────────────────────────────────────────────────────────
// The whole suite is gated behind INTEGRATION_TESTS=true. The live test
// additionally needs a deployed testnet contract and a funded invoker account
// (the fixture the maintainer provisions) supplied via env — without them the
// live case skips with a clear message instead of failing.
const shouldRun = process.env.INTEGRATION_TESTS === "true";

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID ?? "";
const INVOKER_SECRET = process.env.SOROBAN_INVOKER_SECRET ?? "";
// Contract function to invoke; it must emit at least one contract event.
const CONTRACT_FN = process.env.SOROBAN_CONTRACT_FN ?? "increment";

const hasConfig = Boolean(CONTRACT_ID && INVOKER_SECRET);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Invoke a contract function on testnet and return the tx hash + inclusion ledger.
 */
async function invokeContract(): Promise<{ txHash: string; ledger: number }> {
  const server = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.fromSecret(INVOKER_SECRET);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(CONTRACT_FN))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
  }

  // Poll until the transaction is confirmed.
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

/** Resolve once `predicate` returns a value, polling up to `timeoutMs`. */
async function waitFor<T>(predicate: () => T | undefined, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value !== undefined) return value;
    await sleep(500);
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

describe.runIf(shouldRun)("Soroban testnet subscriber — integration", () => {
  let engine: EventEngine | undefined;

  afterEach(async () => {
    await engine?.stop();
    engine = undefined;
  });

  it.runIf(hasConfig)(
    "delivers a typed contract.emitted event within 2 ledgers of an invocation",
    async () => {
      const received: ContractEmittedEvent[] = [];

      engine = new EventEngine({ network: "testnet", soroban: { rpcUrl: RPC_URL } });
      const watcher = engine.subscribeContract(CONTRACT_ID, {
        filters: [{ contractIds: [CONTRACT_ID] }],
      });
      watcher.on("contract.emitted", (event) => {
        const e = event as ContractEmittedEvent;
        if (e.contractId === CONTRACT_ID) received.push(e);
      });

      engine.start();
      // Make sure the subscriber is actually polling the contract before invoking.
      await engine
        .awaitContractSubscriptionActive({ contractId: CONTRACT_ID }, { timeoutMs: 20_000 })
        .catch(() => {
          /* best-effort — fall through to the event wait below */
        });

      const { txHash, ledger } = await invokeContract();

      // The subscriber must surface the emitted event from our invocation. Match
      // on tx hash when the RPC provides it, otherwise accept any event from the
      // contract emitted at/after the invocation ledger.
      const event = await waitFor(
        () => received.find((e) => (e.txHash ? e.txHash === txHash : (e.ledger ?? 0) >= ledger)),
        90_000,
      );

      expect(event.type).toBe("contract.emitted");
      expect(event.contractId).toBe(CONTRACT_ID);
      expect(Array.isArray(event.topics)).toBe(true);
      // Delivered within 2 ledgers of the invocation.
      expect(event.ledger).toBeDefined();
      expect(event.ledger!).toBeLessThanOrEqual(ledger + 2);
    },
    120_000,
  );

  it.skipIf(hasConfig)(
    "skips the live invocation when SOROBAN_CONTRACT_ID / SOROBAN_INVOKER_SECRET are unset",
    () => {
      console.warn(
        "[soroban integration] live test skipped — set SOROBAN_CONTRACT_ID and " +
          "SOROBAN_INVOKER_SECRET (a funded testnet account) to run it against a deployed contract.",
      );
      expect(hasConfig).toBe(false);
    },
  );
});

describe.skipIf(shouldRun)("Soroban testnet subscriber — integration (gated)", () => {
  it("skips unless INTEGRATION_TESTS=true", () => {
    expect(shouldRun).toBe(false);
  });
});
