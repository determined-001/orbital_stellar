/**
 * Locally-reconstructed spec blobs for the bundled well-known specs, keyed by
 * canonical sha256 - the hash the registry publishes on chain.
 *
 * `scripts/seed-well-known.ts` builds each published spec deterministically
 * from `specs/well-known/*.json` plus a pointer URL, then files that spec's
 * canonical hash on chain. The same inputs reproduce the same bytes here, so
 * the blobs can be rebuilt in memory instead of fetched back over the network.
 *
 * Handing these to {@link OnChainAbiRegistryClient} as `offlineBlobs` removes
 * a network dependency without weakening anything: the client still reads the
 * hash from the chain and still verifies the blob against it. A blob only ever
 * gets used when its hash already matches what the chain says, which is the
 * whole guarantee the fetch existed to provide.
 *
 * A spec published with a different pointer, or a newer version, simply will
 * not match and falls through to the pointer as before.
 */

import { createHash } from "node:crypto";
import { canonicalizeSpec } from "./spec.js";
import { loadBundledWellKnownSpecs } from "./BundledWellKnownClient.js";
import type { ContractSpec } from "./spec.js";

/**
 * Where `seed-well-known.ts` points published specs by default. The pointer is
 * part of the spec, so it is part of the hash - this must stay in step with
 * that script's `POINTER_BASE_URL` default or nothing will match.
 */
export const DEFAULT_POINTER_BASE_URL =
  "https://raw.githubusercontent.com/determined-001/orbital_stellar/main/packages/abi-registry/specs/published";

/**
 * Rebuilds the bundled well-known specs as `hash -> canonical JSON`.
 *
 * The value is the canonical serialization rather than the pretty-printed file
 * on disk, because that is what the hash is taken over; the client parses
 * whatever it is given and re-canonicalizes before comparing, so either form
 * verifies, and the canonical one cannot drift from its own hash.
 */
export function buildOfflineBlobs(
  specs: Iterable<ContractSpec>,
  pointerBaseUrl: string = DEFAULT_POINTER_BASE_URL,
): ReadonlyMap<string, string> {
  const blobs = new Map<string, string>();

  for (const spec of specs) {
    if (!spec.contractId) continue;

    const withPointer: ContractSpec = {
      ...spec,
      pointer: `${pointerBaseUrl}/${spec.contractId}.json`,
    };

    const canonical = canonicalizeSpec(withPointer);
    blobs.set(createHash("sha256").update(canonical).digest("hex"), canonical);
  }

  return blobs;
}

/**
 * Convenience wrapper that sources the specs from the bundled files on disk.
 *
 * **Node-only.** It reads the filesystem relative to `import.meta.url`, which a
 * bundler rewrites: under Next/Turbopack the path becomes
 * `/_next/static/media/specs/well-known/usdc.json` and the read throws ENOENT.
 * Anything that gets bundled must import its specs and call
 * {@link buildOfflineBlobs} instead - the split exists precisely so a caller
 * cannot accidentally drag a filesystem read into a browser or edge bundle.
 */
export function buildWellKnownOfflineBlobs(
  pointerBaseUrl: string = DEFAULT_POINTER_BASE_URL,
): ReadonlyMap<string, string> {
  return buildOfflineBlobs(loadBundledWellKnownSpecs().values(), pointerBaseUrl);
}
