import { LruCache } from "./LruCache.js";
import type { AbiRegistryClientConfig, ContractSpec } from "./types.js";

const DEFAULT_MAX_CACHE_SIZE = 512;

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
  async getSpecs(
    contractIds: string[]
  ): Promise<Record<string, ContractSpec | null>> {
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
  private async fetchBatch(
    contractIds: string[]
  ): Promise<Record<string, ContractSpec | null>> {
    const response = await fetch(`${this.baseUrl}/specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractIds }),
    });

    if (!response.ok) {
      throw new Error(
        `ABI registry responded with ${response.status} for batch spec fetch`
      );
    }

    return response.json() as Promise<Record<string, ContractSpec | null>>;
  }
}
