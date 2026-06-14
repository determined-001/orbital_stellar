/**
 * ABI Registry Specification Format Version-Negotiation Behavior
 *
 * All outbound requests from this client are pinned to spec version {@link REGISTRY_SPEC_VERSION}.
 * This explicit version negotiation prevents silent parsing failures when future spec format changes are introduced.
 *
 * 1. Client Version Pinning:
 *    Every HTTP request includes the following header:
 *    `Accept: application/vnd.orbital.abi-registry+json; version=1`
 *
 * 2. Server Response Expectations:
 *    - Supported version (200): The server responds with the payload in the requested format.
 *      The response `Content-Type` should match, e.g. `Content-Type: application/vnd.orbital.abi-registry+json; version=1`.
 *    - Unsupported version (406): If the server cannot satisfy the requested spec version,
 *      it returns `406 Not Acceptable`. This prevents the client from parsing an incompatible payload.
 *
 * 3. Forward Compatibility:
 *    Clients pinned to version 1 continue working as long as the server supports version 1,
 *    even when newer spec versions are available.
 */

export const REGISTRY_SPEC_VERSION = 1;

import { LruCache } from "./LruCache.js";
import type { AbiRegistryClientConfig, ContractSpec } from "./types.js";

const DEFAULT_MAX_CACHE_SIZE = 512;

/**
 * HTTP client for the Orbital ABI Registry API.
 *
 * All requests are pinned to spec version {@link REGISTRY_SPEC_VERSION} via the
 * `Accept` header. Servers that support this version respond with `200` and a
 * matching `Content-Type`. Servers that do not support it respond with `406 Not
 * Acceptable`, preventing the client from silently parsing an incompatible payload.
 *
 * Clients pinned to version 1 remain forward-compatible: they keep working as long
 * as the server continues to serve version 1, even as newer spec versions are added.
 */
export class AbiRegistryClient {
  private readonly baseUrl: string;
  private readonly cache: LruCache<string, ContractSpec | null>;

  constructor(config: AbiRegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.cache = new LruCache(config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE);
  }

  /** Fetch a single contract spec (cached). */
  async getSpec(contractId: string): Promise<ContractSpec | null> {
    const results = await this.getSpecs([contractId]);
    return results[contractId] ?? null;
  }

  /**
   * Fetch specs for multiple contract IDs in a single round-trip.
   * Results are cached; only uncached IDs are fetched from the registry.
   *
   * @returns A record mapping each contractId to its spec, or null if not found.
   */
  async getSpecs(contractIds: string[]): Promise<Record<string, ContractSpec | null>> {
    const result: Record<string, ContractSpec | null> = {};
    const uncached: string[] = [];

    for (const id of contractIds) {
      if (this.cache.has(id)) {
        result[id] = this.cache.get(id) ?? null;
      } else {
        uncached.push(id);
      }
    }

    if (uncached.length === 0) return result;

    const fetched = await this.fetchBatch(uncached);

    for (const id of uncached) {
      const spec = fetched[id] ?? null;
      this.cache.set(id, spec);
      result[id] = spec;
    }

    return result;
  }

  /**
   * POST /specs with the full list of IDs — one round-trip regardless of batch size.
   */
  private async fetchBatch(contractIds: string[]): Promise<Record<string, ContractSpec | null>> {
    const response = await fetch(`${this.baseUrl}/specs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: `application/vnd.orbital.abi-registry+json; version=${REGISTRY_SPEC_VERSION}`,
      },
      body: JSON.stringify({ contractIds }),
    });

    if (!response.ok) {
      throw new Error(`ABI registry responded with ${response.status} for batch spec fetch`);
    }

    return response.json() as Promise<Record<string, ContractSpec | null>>;
  }
}
