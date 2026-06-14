import { CursorStore } from "./CursorStore.js";

interface Entry {
  value: string | null;
  expiresAt: number;
}

/**
 * Wraps a CursorStore with an in-memory TTL cache.
 * - get: returns cached value if still fresh, otherwise delegates to inner and caches result.
 * - set: invalidates the cache entry, then delegates to inner.
 *
 * `getMany` / `setMany` inherit the {@link CursorStore} defaults, which route
 * through this wrapper's cache-aware `get` / `set`. `getAll` delegates straight
 * to the inner store so enumeration stays transparent.
 */
class CacheCursorStore extends CursorStore {
  readonly #inner: CursorStore;
  readonly #ttlMs: number;
  readonly #cache = new Map<string, Entry>();

  constructor(inner: CursorStore, ttlMs: number) {
    super();
    this.#inner = inner;
    this.#ttlMs = ttlMs;
  }

  async get(streamKey: string): Promise<string | null> {
    const entry = this.#cache.get(streamKey);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    const value = await this.#inner.get(streamKey);
    this.#cache.set(streamKey, { value, expiresAt: Date.now() + this.#ttlMs });
    return value;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.#cache.delete(streamKey);
    return this.#inner.set(streamKey, cursor);
  }

  override getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
    return this.#inner.getAll();
  }
}

export function cacheCursorStore(inner: CursorStore, { ttlMs }: { ttlMs: number }): CursorStore {
  return new CacheCursorStore(inner, ttlMs);
}
