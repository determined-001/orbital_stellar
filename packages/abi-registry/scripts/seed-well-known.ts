#!/usr/bin/env node
/**
 * Publishes the bundled well-known specs (USDC, EURC, AQUA, native XLM
 * wrapper - deliberately not `sac-interface.json`, which is a placeholder
 * reference address, not a real deployed contract) through the live on-chain
 * registry contract.
 *
 * This is a MANUAL, gated step - it submits real signed transactions. Run it
 * yourself once the registry contract is deployed
 * (contracts/deploy/deploy_testnet.sh) and its contract ID + a funded
 * publisher secret are available.
 *
 * The on-chain record stores a `pointer` (this script points it at this
 * repo's raw GitHub content at `main`) and a hash of the spec at that
 * pointer. That means the written `specs/published/*.json` files need to be
 * committed and pushed to `main` for the pointer to actually resolve -
 * commit them before (or immediately after) running this script.
 *
 * Entries seeded here get the registry's full-length TTL (the network's
 * max_entry_ttl, ~180 days) because `publish` bumps to it - see
 * contracts/README.md, "Registry durability". They still need
 * scripts/touch-registry.ts run against them on a cadence to stay alive
 * beyond that window.
 *
 * Usage:
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *   npx tsx scripts/seed-well-known.ts
 *
 * Env:
 *   SOROBAN_CONTRACT_ID          - deployed registry contract ID (required)
 *   SOROBAN_INVOKER_SECRET       - publisher's secret key (required)
 *   SOROBAN_RPC_URL              - defaults to https://soroban-testnet.stellar.org
 *   SOROBAN_NETWORK_PASSPHRASE   - defaults to Networks.TESTNET
 *   POINTER_BASE_URL             - defaults to this repo's raw GitHub content at main
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks } from "@stellar/stellar-sdk";
import { wellKnownToContractSpec } from "../src/wellKnown.js";
import { validateSpec } from "../src/spec.js";
import { OnChainRegistryPublisher } from "../src/OnChainRegistryPublisher.js";
import type { WellKnownSpecRaw } from "../src/wellKnown.js";
import type { ContractSpec } from "../src/spec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELL_KNOWN_DIR = resolve(__dirname, "../specs/well-known");
const PUBLISHED_DIR = resolve(__dirname, "../specs/published");

// sac-interface.json is deliberately excluded - its contract_id is a
// placeholder reference address, not a real deployed contract.
const WELL_KNOWN_FILES = ["usdc.json", "eurc.json", "aqua.json", "native-asset-wrapper.json"];

const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID;
const INVOKER_SECRET = process.env.SOROBAN_INVOKER_SECRET;
const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const POINTER_BASE_URL =
  process.env.POINTER_BASE_URL ??
  "https://raw.githubusercontent.com/determined-001/orbital_stellar/main/packages/abi-registry/specs/published";

async function main(): Promise<void> {
  if (!CONTRACT_ID || !INVOKER_SECRET) {
    console.error(
      "seed-well-known: SOROBAN_CONTRACT_ID and SOROBAN_INVOKER_SECRET must both be set.",
    );
    process.exit(1);
  }

  if (!existsSync(PUBLISHED_DIR)) {
    mkdirSync(PUBLISHED_DIR, { recursive: true });
  }

  const publisher = new OnChainRegistryPublisher({
    contractId: CONTRACT_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publisherSecret: INVOKER_SECRET,
  });

  for (const file of WELL_KNOWN_FILES) {
    const raw = JSON.parse(
      readFileSync(resolve(WELL_KNOWN_DIR, file), "utf-8"),
    ) as WellKnownSpecRaw;
    const spec = wellKnownToContractSpec(raw);

    if (!spec.contractId) {
      throw new Error(`${file}: converted spec has no contractId`);
    }

    const pointer = `${POINTER_BASE_URL}/${spec.contractId}.json`;
    const specWithPointer: ContractSpec = { ...spec, pointer };

    const validation = validateSpec(specWithPointer);
    if (!validation.valid) {
      throw new Error(
        `${file}: converted spec failed validation:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    const outPath = resolve(PUBLISHED_DIR, `${spec.contractId}.json`);
    writeFileSync(outPath, `${JSON.stringify(specWithPointer, null, 2)}\n`, "utf-8");
    console.log(`==> Wrote ${outPath}`);

    console.log(`==> Publishing ${spec.name} (${spec.contractId}) version ${spec.version}...`);
    const result = await publisher.publish(specWithPointer);
    console.log(`    published: etag=${result.etag}`);
  }

  console.log(
    "\nDone. Commit and push specs/published/*.json to main so the on-chain pointers resolve.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
