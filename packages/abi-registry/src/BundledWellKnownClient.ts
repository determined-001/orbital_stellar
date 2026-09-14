import { wellKnownToContractSpec } from "./wellKnown.js";
import type { WellKnownSpecRaw } from "./wellKnown.js";
import type { ContractSpec } from "./spec.js";

// Static imports (not a runtime `readFileSync` relative to `import.meta.url`,
// which this file used until it was found to break under any bundler:
// Turbopack and webpack both rewrite `import.meta.url` to the *bundle's* own
// location, not this source file's - the well-known JSON was never actually
// there, so every bundled consumer (apps/web's API routes, via
// `createDefaultAbiRegistryClient`) 500'd with an ENOENT no local,
// unbundled `pnpm test` run ever surfaced. Static imports are what every
// bundler (and real Node ESM, via the `with` import attribute) can resolve
// correctly regardless of how the importing code gets relocated.
//
// sac-interface.json is deliberately excluded - its contract_id is a
// placeholder reference address, not a real deployed contract.
import usdcRaw from "../specs/well-known/usdc.json" with { type: "json" };
import eurcRaw from "../specs/well-known/eurc.json" with { type: "json" };
import aquaRaw from "../specs/well-known/aqua.json" with { type: "json" };
import nativeAssetWrapperRaw from "../specs/well-known/native-asset-wrapper.json" with { type: "json" };

const WELL_KNOWN_RAW: ReadonlyArray<WellKnownSpecRaw> = [
  usdcRaw as WellKnownSpecRaw,
  eurcRaw as WellKnownSpecRaw,
  aquaRaw as WellKnownSpecRaw,
  nativeAssetWrapperRaw as WellKnownSpecRaw,
];

// Computed once at module load - four small specs, not worth lazying behind
// a function call the way a filesystem read was.
let cachedByContractId: Map<string, ContractSpec> | null = null;

function loadBundle(): Map<string, ContractSpec> {
  if (cachedByContractId) return cachedByContractId;

  const map = new Map<string, ContractSpec>();
  for (const raw of WELL_KNOWN_RAW) {
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
