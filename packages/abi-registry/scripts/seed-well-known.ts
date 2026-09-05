#!/usr/bin/env node
/**
 * Publishes the bundled well-known specs (USDC, EURC, AQUA, native XLM
 * wrapper - deliberately not `sac-interface.json`, which is a placeholder
 * reference address, not a real deployed contract) through the live on-chain
 * registry contract.
 *
 * TWO PHASES, ON PURPOSE. The on-chain record stores a `pointer` URL plus a
 * hash of the spec that pointer is supposed to serve. Generating the spec
 * files and publishing their pointers in one pass writes a pointer that
 * cannot resolve yet - the file it names is still uncommitted on someone's
 * laptop. And the registry is immutable per `(contract_id, publisher,
 * version)`, so that dead pointer cannot be corrected under the same version.
 *
 *   1. `generate` - writes `specs/published/*.json`. No network, no secrets.
 *      Commit and push the result.
 *   2. `publish`  - reads those files back, checks each pointer actually
 *      resolves to the exact bytes being hashed, then publishes.
 *
 * Usage:
 *   npx tsx scripts/seed-well-known.ts generate
 *
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *     npx tsx scripts/seed-well-known.ts publish --dry-run
 *
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *     npx tsx scripts/seed-well-known.ts publish
 *
 * Run `--dry-run` first. It builds and simulates every transaction against
 * the live contract without signing or sending, so authorization problems,
 * a wrong contract ID, and already-published versions all surface before
 * anything is spent.
 *
 * Re-running `publish` is safe: a version already on chain reports
 * `AlreadyPublished` and is counted as done rather than aborting the run. A
 * partial failure can therefore be resumed by just running it again.
 *
 * Entries seeded here get the registry's full-length TTL (the network's
 * max_entry_ttl, ~180 days) because `publish` bumps to it - see
 * contracts/README.md, "Registry durability". They still need
 * scripts/touch-registry.ts run against them on a cadence to stay alive
 * beyond that window.
 *
 * Env:
 *   SOROBAN_CONTRACT_ID          - deployed registry contract ID (publish only)
 *   SOROBAN_INVOKER_SECRET       - publisher's secret key (publish only)
 *   SOROBAN_RPC_URL              - defaults to https://soroban-testnet.stellar.org
 *   SOROBAN_NETWORK_PASSPHRASE   - defaults to Networks.TESTNET
 *   POINTER_BASE_URL             - defaults to this repo's raw GitHub content at main
 *   SKIP_POINTER_CHECK=1         - publish even if a pointer does not resolve
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { wellKnownToContractSpec } from "../src/wellKnown.js";
import { validateSpec, canonicalizeSpec } from "../src/spec.js";
import { OnChainRegistryPublisher } from "../src/OnChainRegistryPublisher.js";
import type { WellKnownSpecRaw } from "../src/wellKnown.js";
import type { ContractSpec } from "../src/spec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELL_KNOWN_DIR = resolve(__dirname, "../specs/well-known");
const PUBLISHED_DIR = resolve(__dirname, "../specs/published");

// sac-interface.json is deliberately excluded - its contract_id is a
// placeholder reference address, not a real deployed contract.
const WELL_KNOWN_FILES = ["usdc.json", "eurc.json", "aqua.json", "native-asset-wrapper.json"];

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const POINTER_BASE_URL =
  process.env.POINTER_BASE_URL ??
  "https://raw.githubusercontent.com/determined-001/orbital_stellar/main/packages/abi-registry/specs/published";

/** Builds the spec that phase 1 writes and phase 2 publishes - identical in both. */
function buildSpec(file: string): ContractSpec {
  const raw = JSON.parse(readFileSync(resolve(WELL_KNOWN_DIR, file), "utf-8")) as WellKnownSpecRaw;
  const spec = wellKnownToContractSpec(raw);

  if (!spec.contractId) {
    throw new Error(`${file}: converted spec has no contractId`);
  }

  // Checked here, in the offline phase, because the failure is otherwise
  // invisible until a live publish rejects it mid-run. `aqua.json` shipped a
  // 56-character C-prefixed string that was not a real contract address - the
  // right shape, a bad checksum - and nothing caught it until a transaction
  // was being built against the network.
  if (!StrKey.isValidContract(spec.contractId)) {
    throw new Error(
      `${file}: contract_id "${spec.contractId}" is not a valid contract address (bad checksum)`,
    );
  }

  const specWithPointer: ContractSpec = {
    ...spec,
    pointer: `${POINTER_BASE_URL}/${spec.contractId}.json`,
  };

  const validation = validateSpec(specWithPointer);
  if (!validation.valid) {
    throw new Error(
      `${file}: converted spec failed validation:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return specWithPointer;
}

function specPath(spec: ContractSpec): string {
  return resolve(PUBLISHED_DIR, `${spec.contractId}.json`);
}

function generate(): void {
  if (!existsSync(PUBLISHED_DIR)) {
    mkdirSync(PUBLISHED_DIR, { recursive: true });
  }

  for (const file of WELL_KNOWN_FILES) {
    const spec = buildSpec(file);
    const out = specPath(spec);
    writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");
    console.log(`==> Wrote ${out}`);
  }

  console.log(
    "\nDone. Commit and push specs/published/*.json to main, then run:" +
      "\n  npx tsx scripts/seed-well-known.ts publish --dry-run",
  );
}

/**
 * Confirms the pointer serves exactly the spec being hashed. Publishing a
 * pointer that resolves to different bytes - or to nothing - files a hash on
 * chain that no consumer can ever reproduce, and it cannot be amended under
 * the same version.
 */
async function checkPointer(spec: ContractSpec): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(spec.pointer!);
  } catch (err) {
    return `pointer fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!res.ok) {
    return `pointer returned HTTP ${res.status} (has specs/published/ been pushed to main?)`;
  }

  const served = await res.text();
  let servedSpec: unknown;
  try {
    servedSpec = JSON.parse(served);
  } catch {
    return "pointer did not return valid JSON";
  }

  const servedHash = createHash("sha256")
    .update(canonicalizeSpec(servedSpec as ContractSpec))
    .digest("hex");
  const localHash = createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");

  if (servedHash !== localHash) {
    return `pointer serves a different spec (served ${servedHash.slice(0, 12)}…, local ${localHash.slice(0, 12)}…)`;
  }

  return null;
}

/** The registry's `AlreadyPublished` is error #1 on the contract. */
function isAlreadyPublished(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Error\(Contract, #1\)/.test(msg);
}

async function publish(dryRun: boolean): Promise<void> {
  const contractId = process.env.SOROBAN_CONTRACT_ID;
  const invokerSecret = process.env.SOROBAN_INVOKER_SECRET;

  if (!contractId || !invokerSecret) {
    console.error(
      "seed-well-known: SOROBAN_CONTRACT_ID and SOROBAN_INVOKER_SECRET must both be set to publish.",
    );
    process.exit(1);
  }

  const publisher = new OnChainRegistryPublisher({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publisherSecret: invokerSecret,
    dryRun,
  });

  console.log(
    `==> ${dryRun ? "DRY RUN - simulating against" : "Publishing to"} ${contractId} via ${RPC_URL}\n`,
  );

  const published: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const file of WELL_KNOWN_FILES) {
    const spec = buildSpec(file);
    const label = `${spec.name} (${spec.contractId}) v${spec.version}`;

    if (!existsSync(specPath(spec))) {
      failed.push({
        name: label,
        reason: `${specPath(spec)} missing - run the 'generate' phase first`,
      });
      continue;
    }

    if (process.env.SKIP_POINTER_CHECK !== "1") {
      const pointerProblem = await checkPointer(spec);
      if (pointerProblem) {
        failed.push({ name: label, reason: pointerProblem });
        console.log(`  ✗ ${label}\n      ${pointerProblem}`);
        continue;
      }
    }

    try {
      const result = await publisher.publish(spec);
      published.push(label);
      console.log(
        `  ✓ ${label}\n      etag=${result.etag}${result.txHash ? ` tx=${result.txHash}` : " (simulated)"}`,
      );
    } catch (err) {
      // Immutability per (contract_id, publisher, version) means a version
      // already on chain is the desired end state, not a failure - this is
      // what makes a partial run resumable.
      if (isAlreadyPublished(err)) {
        skipped.push(label);
        console.log(`  = ${label}\n      already published, skipping`);
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ name: label, reason });
      console.log(`  ✗ ${label}\n      ${reason}`);
    }
  }

  console.log(
    `\n${dryRun ? "Dry run" : "Publish"} summary: ${published.length} ${
      dryRun ? "would publish" : "published"
    }, ${skipped.length} already on chain, ${failed.length} failed.`,
  );

  if (failed.length > 0) {
    console.error("\nFailures:");
    for (const f of failed) console.error(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\nNothing was signed or sent. Re-run without --dry-run to publish.");
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  switch (phase) {
    case "generate":
      generate();
      break;
    case "publish":
      await publish(dryRun);
      break;
    default:
      console.error(
        "usage: seed-well-known.ts <generate|publish> [--dry-run]\n\n" +
          "  generate  write specs/published/*.json (no network); commit the result\n" +
          "  publish   publish those specs on chain; run with --dry-run first",
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
