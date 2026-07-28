/**
 * A minimal read-through cache with an explicit TTL and a
 * stale-while-revalidate window, for the hosted registry read API
 * (issue #915 / "12.1").
 *
 * Semantics:
 * - Within `ttlMs` of the last successful fetch: return the cached value,
 *   `servedFrom: "cache"`, `stale: false`.
 * - Between `ttlMs` and `ttlMs + staleWhileRevalidateMs`: return the cached
 *   value immediately with `stale: true` (never served silently as fresh),
 *   and kick off a background revalidation so the *next* caller gets fresh
 *   data. A revalidation failure here is logged and swallowed - the stale
 *   value already served is not retracted.
 * - Beyond that window (or on first call): await a fresh fetch inline. A
 *   failure here propagates to the caller - there's nothing to fall back to.
 *
 * Process-local, in-memory only (an `apps/web` server instance's own
 * memory) - not a shared/distributed cache. Good enough for the read
 * traffic this endpoint expects; revisit if this API runs across multiple
 * instances and cross-instance consistency of the "stale" window matters.
 */

export type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

export type ReadThroughResult<T> = {
  value: T;
  /** `"cache"` covers both fresh and stale cache hits - check `stale` to tell them apart. `"live"` means this call itself performed the fetch. */
  servedFrom: "cache" | "live";
  stale: boolean;
  asOf: string;
};

export type ReadThroughOptions = {
  /** How long a cached value is served as fresh. */
  ttlMs: number;
  /** After `ttlMs`, how much longer a cached value is served (marked `stale: true`) while a background revalidation runs. */
  staleWhileRevalidateMs: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inFlightRevalidation = new Set<string>();

/** Logged rather than thrown - a background revalidation failure must never surface to whichever request happened to be the one that triggered it. */
function logRevalidationFailure(key: string, err: unknown): void {
  console.error(`[registry-api] background revalidation failed for "${key}":`, err);
}

export async function readThrough<T>(
  key: string,
  options: ReadThroughOptions,
  fetcher: () => Promise<T>,
): Promise<ReadThroughResult<T>> {
  const now = Date.now();
  const entry = store.get(key) as CacheEntry<T> | undefined;

  if (entry) {
    const age = now - entry.fetchedAt;
    if (age < options.ttlMs) {
      return { value: entry.value, servedFrom: "cache", stale: false, asOf: new Date(entry.fetchedAt).toISOString() };
    }
    if (age < options.ttlMs + options.staleWhileRevalidateMs) {
      if (!inFlightRevalidation.has(key)) {
        inFlightRevalidation.add(key);
        fetcher()
          .then((value) => store.set(key, { value, fetchedAt: Date.now() }))
          .catch((err) => logRevalidationFailure(key, err))
          .finally(() => inFlightRevalidation.delete(key));
      }
      return { value: entry.value, servedFrom: "cache", stale: true, asOf: new Date(entry.fetchedAt).toISOString() };
    }
  }

  const value = await fetcher();
  const fetchedAt = Date.now();
  store.set(key, { value, fetchedAt });
  return { value, servedFrom: "live", stale: false, asOf: new Date(fetchedAt).toISOString() };
}

/** Test/diagnostic escape hatch - clears every cached entry. */
export function clearReadThroughCache(): void {
  store.clear();
  inFlightRevalidation.clear();
}

/** Reads whatever is cached under `key` without triggering a fetch or affecting freshness. `undefined` if nothing has ever been cached under this key. Used by health checks that want "whatever we last saw" without paying for (or waiting on) a fresh call. */
export function peekReadThroughCache<T>(key: string): CacheEntry<T> | undefined {
  return store.get(key) as CacheEntry<T> | undefined;
}
