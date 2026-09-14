// Shared infrastructure for the hosted registry read API (issue #915):
// GET /api/v1/registry/{spec/:contractId,taxonomy,labels,health,openapi.json}.
//
// Distinct from /api/registry-data/* (issue 16.2's internal, rate-limited
// feed for the /explore page) and from HostedAbiRegistryClient's
// /v1/specs/:contractId (a different, already-shipped raw-XDR cache the SDK's
// own resolution chain calls). This is the public, documented, versioned API
// surface issue #915 asks for - same underlying data, a different contract.

import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import {
  createDefaultAbiRegistryClient,
  canonicalizeSpec,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import type { ContractSpec, ResolvedSpec } from "@orbital-stellar/abi-registry";
import { getTaxonomyRecords, getLabelRecords } from "@/lib/registryData";
import type { TaxonomyRecord, LabelRecord } from "@/lib/registryData";

/**
 * Every /v1/registry response envelope: `servedFrom` says which link in the
 * resolution chain answered (or "static" for the taxonomy/label datasets,
 * which are build-time files, not chain-resolved), `asOfLedger` is the
 * Soroban ledger sequence this response reflects, and `stale` is explicit
 * (never silent) per the read-through cache's stale-while-revalidate policy.
 */
export type HostedApiEnvelope<T> = {
  data: T;
  servedFrom: string;
  asOfLedger: number;
  stale: boolean;
};

/**
 * A read-through cache: serves a fresh value directly within `ttlMs`, serves
 * the last known value (marked `stale: true`) while kicking off a background
 * refresh within `ttlMs + staleMs`, and blocks on a fresh fetch once both
 * windows have elapsed. Never returns stale data without saying so - that is
 * the whole point of the `stale` flag on every result.
 */
export class SwrCache<T> {
  private entry: { value: T; fetchedAt: number } | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly staleMs: number,
  ) {}

  async get(fetcher: () => Promise<T>): Promise<{ value: T; stale: boolean }> {
    const now = Date.now();
    if (this.entry) {
      const age = now - this.entry.fetchedAt;
      if (age <= this.ttlMs) {
        return { value: this.entry.value, stale: false };
      }
      if (age <= this.ttlMs + this.staleMs) {
        this.triggerBackgroundRefresh(fetcher);
        return { value: this.entry.value, stale: true };
      }
      // Past the stale window entirely: no value is fresh enough to serve
      // at all, so this falls through to a blocking fetch below.
    }
    const value = await this.refreshNow(fetcher);
    return { value, stale: false };
  }

  /** Test-only: forces the next `get()` to treat the cache as empty. */
  clear(): void {
    this.entry = undefined;
    this.refreshing = undefined;
  }

  private triggerBackgroundRefresh(fetcher: () => Promise<T>): void {
    if (this.refreshing) return;
    this.refreshing = this.refreshNow(fetcher)
      .then(() => undefined)
      .catch((err: unknown) => {
        // A failed background refresh keeps serving the last good value
        // (still marked stale) rather than losing it - logged so a
        // persistently failing upstream is visible in server logs.
        console.error("SwrCache: background refresh failed", err);
      })
      .finally(() => {
        this.refreshing = undefined;
      });
  }

  private async refreshNow(fetcher: () => Promise<T>): Promise<T> {
    const value = await fetcher();
    this.entry = { value, fetchedAt: Date.now() };
    return value;
  }
}

// 5s fresh, 55s more of "stale but usable while refreshing in the
// background" - the ledger closes roughly every 5s, so this is fresh enough
// to be meaningful as "as of" provenance without hitting RPC on every request.
const LEDGER_CACHE = new SwrCache<number>(5_000, 55_000);
// Resolved specs change only when someone republishes a version; 60s fresh,
// 5 more minutes of serving-stale-while-revalidating matches
// REGISTRY_DATA_CACHE_CONTROL's existing max-age=60/stale-while-revalidate=3600
// convention closely enough without copying its very long tail (a public API
// consumer polling for a just-published update shouldn't wait an hour).
const SPEC_CACHES = new Map<string, SwrCache<ResolvedSpec | null>>();
const TAXONOMY_CACHE = new SwrCache<TaxonomyRecord[]>(60_000, 300_000);
const LABELS_CACHE = new SwrCache<LabelRecord[]>(60_000, 300_000);

const rpcServer = new SorobanRpc.Server(
  process.env.ORBITAL_REGISTRY_TESTNET_RPC_URL?.trim() || ORBITAL_REGISTRY_TESTNET_RPC_URL,
);

// Constructed once at module scope, like apps/web/app/api/registry-data/spec/[contractId]/route.ts's
// defaultChainClient - a fresh instance per request would defeat its own
// internal caches the moment the on-chain link is populated.
const defaultChainClient = createDefaultAbiRegistryClient();

/** Current Soroban ledger sequence, read through {@link SwrCache}. */
export async function getCachedLedgerSequence(): Promise<{ value: number; stale: boolean }> {
  return LEDGER_CACHE.get(async () => {
    const latest = await rpcServer.getLatestLedger();
    return latest.sequence;
  });
}

/** Resolves `contractId`'s spec via the default chain, read through {@link SwrCache}. */
export async function getCachedResolvedSpec(
  contractId: string,
): Promise<{ value: ResolvedSpec | null; stale: boolean }> {
  let cache = SPEC_CACHES.get(contractId);
  if (!cache) {
    cache = new SwrCache<ResolvedSpec | null>(60_000, 300_000);
    SPEC_CACHES.set(contractId, cache);
  }
  return cache.get(() => defaultChainClient.getResolvedSpec(contractId));
}

/** The open taxonomy dataset, read through {@link SwrCache}. */
export async function getCachedTaxonomy(): Promise<{ value: TaxonomyRecord[]; stale: boolean }> {
  return TAXONOMY_CACHE.get(async () => getTaxonomyRecords());
}

/** The open entity-label dataset, read through {@link SwrCache}. */
export async function getCachedLabels(): Promise<{ value: LabelRecord[]; stale: boolean }> {
  return LABELS_CACHE.get(async () => getLabelRecords());
}

/** Canonical sha256 spec hash - the same hash the on-chain registry stores. */
export function specHashOf(spec: ContractSpec): string {
  return createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");
}

/** Test-only: resets every module-level cache between test cases. */
export function __resetHostedRegistryApiCachesForTests(): void {
  LEDGER_CACHE.clear();
  SPEC_CACHES.clear();
  TAXONOMY_CACHE.clear();
  LABELS_CACHE.clear();
}
