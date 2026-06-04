import { CursorStore } from "./CursorStore.js";

/**
 * Minimal interface that any Redis client must satisfy to be used with
 * `RedisCursorStore`. Compatible with `ioredis`, `node-redis`, and any
 * other client that exposes these four methods.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  mset(...args: string[]): Promise<unknown>;
}

/**
 * A `CursorStore` adapter backed by a Redis-compatible client.
 *
 * Batch reads use a single `MGET` call and batch writes use a single `MSET`
 * call, reducing N cursor updates to one network round-trip.
 */
export class RedisCursorStore extends CursorStore {
  constructor(private readonly redis: RedisLike) {
    super();
  }

  /**
   * Retrieves the stored cursor for a given stream key.
   * Returns null if no cursor has been stored yet.
   */
  async get(streamKey: string): Promise<string | null> {
    return this.redis.get(streamKey);
  }

  /**
   * Stores or updates the cursor for a given stream key.
   */
  async set(streamKey: string, cursor: string): Promise<void> {
    await this.redis.set(streamKey, cursor);
  }

  /**
   * Retrieves the stored cursors for multiple stream keys in a single MGET
   * round-trip. Keys with no stored cursor are mapped to `null`.
   *
   * Short-circuits on empty input without issuing any Redis command.
   */
  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    if (keys.length === 0) return {};
    const values = await this.redis.mget(...keys);
    const result: Record<string, string | null> = {};
    for (let i = 0; i < keys.length; i++) {
      // keys[i] and values[i] are always defined here because i < keys.length
      // and mget returns an array of the same length as the input keys.
      result[keys[i]!] = values[i] ?? null;
    }
    return result;
  }

  /**
   * Stores or updates the cursors for multiple stream keys in a single MSET
   * round-trip. Flattens entries to the interleaved [k1, v1, k2, v2, …]
   * format expected by Redis MSET.
   *
   * Short-circuits on empty input without issuing any Redis command.
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    const pairs = Object.entries(entries);
    if (pairs.length === 0) return;
    // Flatten to [key1, val1, key2, val2, …] for MSET
    const args = pairs.flat();
    await this.redis.mset(...args);
  }
}
