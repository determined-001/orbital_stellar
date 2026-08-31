#!/usr/bin/env node
/**
 * Keeper: extends the TTL of registry entries back out to the network
 * maximum so published specs never archive out from under their consumers.
 *
 * The registry's read paths (`latest`, `get_version`, `list_versions*`) are
 * deliberately pure - every resolver reads them through `simulateTransaction`
 * with an unfunded throwaway source, and a read that wrote would turn spec
 * resolution into a signed, fee-paying transaction for every consumer. The
 * write path bumps to `max_entry_ttl` (~180 days), and this script is the
 * supported way to keep an entry alive past that without republishing.
 *
 * CADENCE: run it at least every 90 days per (contract_id, publisher) pair -
 * half the ~180-day window, so one missed run is not an outage. The contract
 * only pays rent when an entry is within 30 days of expiring
 * (`LIFETIME_THRESHOLD`), so running it more often than that is cheap: the
 * extension is a no-op until the entry is actually close to the edge.
 *
 * This submits real, signed, fee-paying transactions.
 *
 * Usage:
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *   REGISTRY_PUBLISHER=G... TARGET_CONTRACT_IDS=C...,C... \
 *   npx tsx scripts/touch-registry.ts
 *
 * Env:
 *   SOROBAN_CONTRACT_ID          - deployed registry contract ID (required)
 *   SOROBAN_INVOKER_SECRET       - secret key that signs and pays (required).
 *                                  TTL extension is permissionless, so this
 *                                  needs to be funded, not privileged.
 *   REGISTRY_PUBLISHER           - publisher address whose entries to keep
 *                                  alive (required)
 *   TARGET_CONTRACT_IDS          - comma-separated contract IDs to touch (required)
 *   SOROBAN_RPC_URL              - defaults to https://soroban-testnet.stellar.org
 *   SOROBAN_NETWORK_PASSPHRASE   - defaults to Networks.TESTNET
 */

import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/** Mirrors MAX_PAGE_SIZE in contracts/registry/src/lib.rs. */
const MAX_PAGE_SIZE = 25;

const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID;
const INVOKER_SECRET = process.env.SOROBAN_INVOKER_SECRET;
const PUBLISHER = process.env.REGISTRY_PUBLISHER;
const TARGETS = (process.env.TARGET_CONTRACT_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;

async function listVersions(
  server: SorobanRpc.Server,
  registryContractId: string,
  targetContractId: string,
): Promise<string[]> {
  const versions: string[] = [];
  let cursor: number | null = 0;

  while (cursor !== null) {
    const source = new Account(Keypair.random().publicKey(), "0");
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(registryContractId).call(
          "list_versions_paged",
          nativeToScVal(targetContractId, { type: "address" }),
          nativeToScVal(PUBLISHER!, { type: "address" }),
          nativeToScVal(cursor, { type: "u32" }),
          nativeToScVal(MAX_PAGE_SIZE, { type: "u32" }),
        ),
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(
        `touch-registry: list_versions_paged failed for ${targetContractId}: ${sim.error}`,
      );
    }
    if (!("result" in sim) || !sim.result) break;

    const [page, next] = scValToNative(sim.result.retval) as [string[], number | null];
    versions.push(...page.filter((v) => !v.startsWith("__truncated")));
    cursor = next;
  }

  return versions;
}

async function touch(
  server: SorobanRpc.Server,
  keypair: Keypair,
  registryContractId: string,
  targetContractId: string,
  versions: string[],
): Promise<number> {
  const source = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(registryContractId).call(
        "touch",
        nativeToScVal(targetContractId, { type: "address" }),
        nativeToScVal(PUBLISHER!, { type: "address" }),
        xdr.ScVal.scvVec(versions.map((v) => nativeToScVal(v, { type: "string" }))),
      ),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`touch-registry: sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(sent.hash);
    if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(
          `touch-registry: transaction ${sent.hash} failed with status ${result.status}`,
        );
      }
      return result.returnValue ? Number(scValToNative(result.returnValue)) : 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`touch-registry: transaction ${sent.hash} not confirmed within 60000ms`);
}

async function main(): Promise<void> {
  if (!CONTRACT_ID || !INVOKER_SECRET || !PUBLISHER || TARGETS.length === 0) {
    console.error(
      "touch-registry: SOROBAN_CONTRACT_ID, SOROBAN_INVOKER_SECRET, REGISTRY_PUBLISHER and TARGET_CONTRACT_IDS must all be set.",
    );
    process.exit(1);
  }

  const server = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.fromSecret(INVOKER_SECRET);

  for (const target of TARGETS) {
    const versions = await listVersions(server, CONTRACT_ID, target);
    if (versions.length === 0) {
      console.warn(
        `touch-registry: ${target} - no versions published under ${PUBLISHER}, skipping`,
      );
      continue;
    }

    // `touch` caps its footprint at MAX_PAGE_SIZE versions per call, so a
    // contract with more versions than that is kept alive across several
    // transactions. The index entries are re-extended by each call; that is
    // a cheap no-op once the first call has pushed them out to the maximum.
    for (let i = 0; i < versions.length; i += MAX_PAGE_SIZE) {
      const page = versions.slice(i, i + MAX_PAGE_SIZE);
      const extended = await touch(server, keypair, CONTRACT_ID, target, page);
      console.log(
        `touch-registry: ${target} - extended ${extended} entries (versions ${i + 1}-${i + page.length} of ${versions.length})`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
