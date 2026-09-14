import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { OnChainAbiRegistryClient } from "../../src/OnChainAbiRegistryClient.js";
import { wellKnownToContractSpec } from "../../src/wellKnown.js";
import { canonicalizeSpec } from "../../src/spec.js";
import {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
  ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE,
} from "../../src/registryConstants.js";
import type { WellKnownSpecRaw } from "../../src/wellKnown.js";

/**
 * Live chain-resolution test for issue #890: resolves each of the four
 * bundled well-known specs through the real deployed registry contract (not
 * the bundle fallback) and asserts the on-chain spec_hash matches what the
 * committed well-known JSON canonicalizes to. Read-only - no secret needed,
 * so unlike packages/pulse-core/test/integration/soroban.test.ts's live
 * case, this one only needs INTEGRATION_TESTS=true, not a funded account.
 */
const shouldRun = process.env.INTEGRATION_TESTS === "true";

const RPC_URL = process.env.SOROBAN_RPC_URL ?? ORBITAL_REGISTRY_TESTNET_RPC_URL;
const NETWORK_PASSPHRASE =
  process.env.SOROBAN_NETWORK_PASSPHRASE ?? ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE;
// Orbital's deployed registry contract + canonical publisher - same env var
// names integration.yml already plumbs through as repo secrets, falling back
// to the package's own committed constants (contracts/deployed.testnet.json,
// packages/abi-registry/src/registryConstants.ts) since a contract ID and a
// public key are public chain data, not secrets.
const REGISTRY_CONTRACT_ID =
  process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID || ORBITAL_REGISTRY_TESTNET_CONTRACT_ID;
const REGISTRY_PUBLISHER =
  process.env.ORBITAL_REGISTRY_PUBLISHER_ADDRESS || ORBITAL_REGISTRY_PUBLISHER_ADDRESS;

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELL_KNOWN_DIR = resolve(__dirname, "../../specs/well-known");
const WELL_KNOWN_FILES = ["usdc.json", "eurc.json", "aqua.json", "native-asset-wrapper.json"];

// scripts/seed-well-known.ts's POINTER_BASE_URL default - the pointer is part
// of what gets hashed (see below), so it has to match exactly what was
// actually published, not just the spec's own fields.
const POINTER_BASE_URL =
  process.env.POINTER_BASE_URL ??
  "https://raw.githubusercontent.com/determined-001/orbital_stellar/main/packages/abi-registry/specs/published";

const maybeDescribe = shouldRun ? describe : describe.skip;

maybeDescribe("registry seed (issue #890) - live chain resolution", () => {
  const client = new OnChainAbiRegistryClient({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publisher: REGISTRY_PUBLISHER,
  });

  it.each(WELL_KNOWN_FILES)("%s resolves from the live registry at version 1.0.0", async (file) => {
    const raw = JSON.parse(
      readFileSync(resolve(WELL_KNOWN_DIR, file), "utf-8"),
    ) as WellKnownSpecRaw;
    const spec = wellKnownToContractSpec(raw);
    expect(spec.contractId).toBeTruthy();

    // The registry hashes the spec *with* its pointer field set (see
    // scripts/seed-well-known.ts's buildSpec) - the hash committed on chain
    // covers where the blob is served from, not just the blob's own content.
    const specWithPointer = {
      ...spec,
      pointer: `${POINTER_BASE_URL}/${spec.contractId}.json`,
    };
    const localHash = createHash("sha256").update(canonicalizeSpec(specWithPointer)).digest("hex");

    const records = await client.getRecords(spec.contractId!);
    const v1 = records.find((r) => r.version === "1.0.0");

    expect(v1, `no v1.0.0 record on chain for ${file} (${spec.contractId})`).toBeDefined();
    expect(v1!.specHash).toBe(localHash);
    expect(v1!.publisher).toBe(REGISTRY_PUBLISHER);
  });
});
