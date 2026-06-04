import { CursorStore } from "./CursorStore.js";

interface Entry {
  value: string | null;
  expiresAt: number;
}

/**
 * Wraps a CursorStore with an in-memory TTL cache.
 * - get: returns cached value if still fresh, otherwise delegates to inner and caches result.
 * - set: invalidates the cache entry, then delegates to inner.
 */
export function cacheCursorStore(
  inner: CursorStore,
  { ttlMs }: { ttlMs: number },
): CursorStore {
  const cache = new Map<string, Entry>();

  class CachedCursorStore extends CursorStore {
    async get(streamKey: string): Promise<string | null> {
      const entry = cache.get(streamKey);
      if (entry && Date.now() < entry.expiresAt) return entry.value;
      const value = await inner.get(streamKey);
      cache.set(streamKey, { value, expiresAt: Date.now() + ttlMs });
      return value;
    }

    async set(streamKey: string, cursor: string): Promise<void> {
      cache.delete(streamKey);
      return inner.set(streamKey, cursor);
    }

    override async getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
      return inner.getAll ? inner.getAll() : [];
    }

    override async ping(): Promise<void> {
      if (inner.ping) {
        return inner.ping();
      }
    }
  }

  return new CachedCursorStore();
}
