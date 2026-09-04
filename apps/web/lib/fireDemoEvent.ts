import "server-only";

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
import { assertRestrictedSecretNetwork, isCiEnvironment } from "@orbital-stellar/pulse-core";

const RPC_URL = process.env.DEMO_EMITTER_RPC_URL ?? "https://soroban-testnet.stellar.org";

/**
 * The demo invoker is exposed to anonymous visitors through a button, so it is
 * testnet-only by construction. If this deployment is ever pointed at mainnet,
 * refuse to sign rather than move real value on a stranger's click.
 */
const NETWORK_PASSPHRASE = process.env.DEMO_EMITTER_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export type FireDemoEventResult = { txHash: string; ledger: number; contractId: string };

export class DemoEmitterNotConfiguredError extends Error {
  constructor() {
    super(
      "DEMO_EMITTER_CONTRACT_ID and DEMO_EMITTER_SECRET are not configured - the demo-emitter contract hasn't been deployed to this environment yet.",
    );
    this.name = "DemoEmitterNotConfiguredError";
  }
}

/**
 * The manifest fallback is a local-development convenience: `deployed.testnet.json`
 * lives outside `apps/web` and is not traced into the serverless bundle, so it is
 * never present in a deployed build (#1030). In production the env var is required.
 */
function isProductionRuntime(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

export type DemoEmitterConfigStatus =
  /** Contract ID resolved (env var, or manifest fallback in local development). */
  | "ok"
  /** Nothing is configured: the feature is deliberately off in this environment. */
  | "unconfigured"
  /** A source of configuration exists but could not be read or parsed. */
  | "unreadable";

export type DemoEmitterResolution = {
  contractId: string | null;
  status: DemoEmitterConfigStatus;
  /** Operator-facing detail for `unconfigured` / `unreadable`. Never a secret. */
  reason?: string;
};

/**
 * Resolves the demo-emitter contract ID and reports *why* it could not be
 * resolved, so a deployed failure is diagnosable from the outside instead of
 * silently reporting itself unconfigured (#1030).
 */
export function resolveDemoEmitter(): DemoEmitterResolution {
  const fromEnv = process.env.DEMO_EMITTER_CONTRACT_ID?.trim();
  if (fromEnv && !isPlaceholderContractId(fromEnv)) {
    return { contractId: fromEnv, status: "ok" };
  }

  if (isProductionRuntime()) {
    return {
      contractId: null,
      status: "unconfigured",
      reason:
        "DEMO_EMITTER_CONTRACT_ID is required in production - the deployment manifest fallback is local-development only.",
    };
  }

  const deployManifestPath = resolve(
    process.cwd(),
    "..",
    "..",
    "contracts",
    "deployed.testnet.json",
  );

  if (!existsSync(deployManifestPath)) {
    return {
      contractId: null,
      status: "unconfigured",
      reason: `DEMO_EMITTER_CONTRACT_ID is unset and no deployment manifest at ${deployManifestPath}.`,
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(deployManifestPath, "utf-8")) as {
      contracts?: { demoEmitter?: { contractId?: string } };
    };
    const id = manifest.contracts?.demoEmitter?.contractId ?? null;
    if (id && !isPlaceholderContractId(id)) {
      return { contractId: id, status: "ok" };
    }
    return {
      contractId: null,
      status: "unconfigured",
      reason: `Deployment manifest at ${deployManifestPath} has no usable contracts.demoEmitter.contractId.`,
    };
  } catch (error) {
    // Do not swallow: an unreadable manifest is a configuration failure, not an
    // absence of configuration, and the two are diagnosed differently.
    console.warn(
      `fireDemoEvent: failed to read demo-emitter manifest at ${deployManifestPath}:`,
      error,
    );
    return {
      contractId: null,
      status: "unreadable",
      reason: `Deployment manifest at ${deployManifestPath} could not be read or parsed.`,
    };
  }
}

/** Returns the demo-emitter contract ID from env var or deployed.testnet.json, or null. */
function resolveDemoEmitterContractId(): string | null {
  return resolveDemoEmitter().contractId;
}

/** Honest placeholders from deploy_testnet.sh must not count as configured. */
function isPlaceholderContractId(id: string): boolean {
  return id.startsWith("<") || id.includes("POPULATED BY") || id.length < 8;
}

/**
 * Returns whether the demo-emitter contract is configured for use.
 */
export function isDemoEmitterConfigured(): boolean {
  return getDemoEmitterConfig().configured;
}

/**
 * Configuration report for `/api/demo/config`. Distinguishes "not configured"
 * (feature deliberately off) from "configuration could not be read" (#1030).
 */
export function getDemoEmitterConfig(): {
  configured: boolean;
  status: DemoEmitterConfigStatus;
  reason?: string;
} {
  const resolution = resolveDemoEmitter();
  const secret = process.env.DEMO_EMITTER_SECRET;

  if (resolution.status !== "ok") {
    return { configured: false, status: resolution.status, reason: resolution.reason };
  }
  if (!secret) {
    return {
      configured: false,
      status: "unconfigured",
      reason: "DEMO_EMITTER_SECRET is not set.",
    };
  }
  return { configured: true, status: "ok" };
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

  // Startup assertion (#926): a mainnet-configured demo path never signs.
  assertRestrictedSecretNetwork({
    secretName: "DEMO_EMITTER_SECRET",
    networkPassphrase: NETWORK_PASSPHRASE,
    context: isCiEnvironment() ? "ci" : "demo",
  });

  const server = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.fromSecret(secret);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
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
