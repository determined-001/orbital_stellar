/**
 * Worker registry client for resolving operator and offering records.
 *
 * Reuses abi-registry's {@link LruCache} and {@link TtlLruCache} for
 * resolution and caching, keeping one registry concept across spec and
 * worker records.
 */

import {
  validateOperatorRecord,
  validateWorkerOfferingRecord,
  LruCache,
  TtlLruCache,
} from "@orbital-stellar/abi-registry";
import type {
  OperatorRecord,
  WorkerOfferingRecord,
  OperatorValidationResult,
  WorkerOfferingValidationResult,
} from "@orbital-stellar/abi-registry";

// ── Cache defaults ──────────────────────────────────────────────────────────

const DEFAULT_MAX_CACHE_SIZE = 512;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────────────

export type WorkerRegistryClientConfig = {
  /** Base URL of the hosted worker registry. */
  baseUrl: string;
  /** Maximum number of records to keep in the LRU cache. Defaults to 512. */
  maxCacheSize?: number;
  /** Time-to-live for cached records in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number;
};

// ── Client ──────────────────────────────────────────────────────────────────

/**
 * Client for resolving operator and offering records from the worker registry.
 *
 * Caches resolved records using {@link TtlLruCache} to avoid redundant
 * fetches. Validates every record against the TypeScript validators on
 * receipt and returns a clear error on malformed data.
 */
export class WorkerRegistryClient {
  private readonly operatorCache: TtlLruCache<OperatorRecord>;
  private readonly offeringCache: TtlLruCache<WorkerOfferingRecord>;
  private readonly baseUrl: string;

  constructor(config: WorkerRegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.operatorCache = new TtlLruCache<OperatorRecord>(
      config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    );
    this.offeringCache = new TtlLruCache<WorkerOfferingRecord>(
      config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    );
  }

  /**
   * Resolve an operator record by ID. Returns `null` if not found or
   * validation fails.
   */
  async resolveOperator(id: string): Promise<OperatorRecord | null> {
    const cached = this.operatorCache.get(id);
    if (cached) return cached;

    const res = await fetch(`${this.baseUrl}/operators/${id}.json`);
    if (!res.ok) return null;

    const json = await res.json();
    const result: OperatorValidationResult = validateOperatorRecord(json);
    if (!result.valid) return null;

    const record = json as OperatorRecord;
    this.operatorCache.set(id, record);
    return record;
  }

  /**
   * Resolve a worker offering record by ID. Returns `null` if not found or
   * validation fails.
   */
  async resolveOffering(id: string): Promise<WorkerOfferingRecord | null> {
    const cached = this.offeringCache.get(id);
    if (cached) return cached;

    const res = await fetch(`${this.baseUrl}/offerings/${id}.json`);
    if (!res.ok) return null;

    const json = await res.json();
    const result: WorkerOfferingValidationResult = validateWorkerOfferingRecord(json);
    if (!result.valid) return null;

    const record = json as WorkerOfferingRecord;
    this.offeringCache.set(id, record);
    return record;
  }

  /**
   * List all offerings for a given operator. Returns empty array if none
   * found or on error.
   */
  async listOfferingsForOperator(operatorId: string): Promise<WorkerOfferingRecord[]> {
    const res = await fetch(`${this.baseUrl}/operators/${operatorId}/offerings.json`);
    if (!res.ok) return [];

    const json = await res.json();
    if (!Array.isArray(json)) return [];

    const valid: WorkerOfferingRecord[] = [];
    for (const item of json) {
      const result = validateWorkerOfferingRecord(item);
      if (result.valid) {
        valid.push(item as WorkerOfferingRecord);
      }
    }
    return valid;
  }
}
