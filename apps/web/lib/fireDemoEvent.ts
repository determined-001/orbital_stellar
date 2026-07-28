import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.DEMO_EMITTER_RPC_URL ?? "https://soroban-testnet.stellar.org";

export type FireDemoEventResult = { txHash: string; ledger: number; contractId: string };

export class DemoEmitterNotConfiguredError extends Error {
  constructor() {
    super(
      "DEMO_EMITTER_CONTRACT_ID and DEMO_EMITTER_SECRET are not configured - the demo-emitter contract hasn't been deployed to this environment yet.",
    );
    this.name = "DemoEmitterNotConfiguredError";
  }
}

/** Returns the demo-emitter contract ID from env var or deployed.testnet.json, or null. */
function resolveDemoEmitterContractId(): string | null {
  const fromEnv = process.env.DEMO_EMITTER_CONTRACT_ID;
  if (fromEnv) return fromEnv;

  try {
    const deployManifestPath = resolve(
      process.cwd(),
      "..",
      "..",
      "contracts",
      "deployed.testnet.json",
    );
    if (existsSync(deployManifestPath)) {
      const manifest = JSON.parse(readFileSync(deployManifestPath, "utf-8")) as {
        contracts?: { demoEmitter?: { contractId?: string } };
      };
      return manifest.contracts?.demoEmitter?.contractId ?? null;
    }
  } catch {
    // File may not exist (pre-deployment)
  }
  return null;
}

/**
 * Returns whether the demo-emitter contract is configured for use.
 */
export function isDemoEmitterConfigured(): boolean {
  const contractId = resolveDemoEmitterContractId();
  const secret = process.env.DEMO_EMITTER_SECRET;
  return !!(contractId && secret);
}

/**
 * Invokes the deployed `orbital-demo-emitter` contract's no-arg `ping()`
 * (see contracts/demo-emitter) on testnet and waits for confirmation. Used
 * by the "Fire test event" button on /demo/contracts - the visitor's
 * already-open SSE stream against this same contract ID surfaces the
 * resulting `contract.emitted` event within a few seconds.
 *
 * `DEMO_EMITTER_SECRET` is deliberately a separate key from
 * `SOROBAN_INVOKER_SECRET` (the registry's nightly-test invoker) - it can
 * only ever call this one harmless no-arg function, so its blast radius if
 * leaked is far smaller.
 */
export async function fireDemoEvent(): Promise<FireDemoEventResult> {
  const contractId = resolveDemoEmitterContractId();
  const secret = process.env.DEMO_EMITTER_SECRET;
  if (!contractId || !secret) {
    throw new DemoEmitterNotConfiguredError();
  }

  const server = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.fromSecret(secret);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("ping"))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`fireDemoEvent: sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(sent.hash);
    if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`fireDemoEvent: transaction failed with status ${result.status}`);
      }
      return { txHash: sent.hash, ledger: result.ledger, contractId };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("fireDemoEvent: transaction not confirmed within 30s");
}
