import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wellKnownToContractSpec } from "./wellKnown.js";
import type { WellKnownSpecRaw } from "./wellKnown.js";
import type { ContractSpec } from "./spec.js";

// sac-interface.json is deliberately excluded - its contract_id is a
// placeholder reference address, not a real deployed contract.
const WELL_KNOWN_FILES = ["usdc.json", "eurc.json", "aqua.json", "native-asset-wrapper.json"];

// Lazy-loaded so tests/consumers that never call getSpec don't touch the filesystem.
let cachedByContractId: Map<string, ContractSpec> | null = null;

function loadBundle(): Map<string, ContractSpec> {
  if (cachedByContractId) return cachedByContractId;

  const wellKnownDir = resolve(
    new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "../specs/well-known",
  );

  const map = new Map<string, ContractSpec>();
  for (const file of WELL_KNOWN_FILES) {
    const raw = JSON.parse(readFileSync(resolve(wellKnownDir, file), "utf-8")) as WellKnownSpecRaw;
    const spec = wellKnownToContractSpec(raw);
    if (spec.contractId) map.set(spec.contractId, spec);
  }
  cachedByContractId = map;
  return map;
}

/**
 * The bundled well-known specs, keyed by contract id.
 *
 * Exported so anything else that needs the same set - `offlineBlobs.ts`
 * rebuilding published blobs, for one - reads it from here rather than keeping
 * a second copy of the file list. Which files are bundled, and the fact that
 * `sac-interface.json` is not among them, is a decision that should live in one
 * place.
 */
export function loadBundledWellKnownSpecs(): ReadonlyMap<string, ContractSpec> {
  return loadBundle();
}

/**
 * Resolves the specs bundled with this package (USDC, EURC, AQUA, the
 * native XLM wrapper) entirely offline - no network, no on-chain registry
 * required. The first link in {@link createDefaultAbiRegistryClient}'s
 * default resolution chain.
 */
export class BundledWellKnownClient {
  async getSpec(contractId: string): Promise<ContractSpec | null> {
    return loadBundle().get(contractId) ?? null;
  }
}
