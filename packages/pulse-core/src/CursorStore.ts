/**
 * Pluggable durable store abstract base class for the Horizon stream cursor.
 *
 * Concrete adapters must implement `get` and `set`. The `getMany` and `setMany`
 * methods have default implementations that delegate to the single-key operations
 * sequentially; adapters capable of batching (e.g. Postgres, Redis) may override
 * them for efficiency.
 */
export abstract class CursorStore {
  /**
   * Retrieves the stored cursor for a given stream key.
   * Returns null if no cursor has been stored yet.
   */
  abstract get(streamKey: string): Promise<string | null>;

  /**
   * Stores or updates the cursor for a given stream key.
   */
  abstract set(streamKey: string, cursor: string): Promise<void>;

  /**
   * Optional liveness probe. If present, EventEngine.healthCheck() will call
   * it and report ok: false if it rejects.
   */
  ping?(): Promise<void>;

  /**
   * Returns all stored stream-key → cursor entries.
   * Used by the cursor migration utility to bulk-copy state between stores.
   */
  getAll?(): Promise<Array<{ streamKey: string; cursor: string }>>;

  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    if (keys.length === 0) return {};
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async setMany(entries: Record<string, string>): Promise<void> {
    const pairs = Object.entries(entries);
    if (pairs.length === 0) return;
    for (const [key, value] of pairs) {
      await this.set(key, value);
    }
  }
}
