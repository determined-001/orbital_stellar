/**
 * Pluggable durable store for Horizon and Soroban stream cursors.
 *
 * Cursor values are source-local opaque strings. Store implementations should
 * persist and return them exactly as received from Horizon or Soroban RPC.
 *
 * Subclasses must implement the single-key {@link get} and {@link set}
 * primitives. The batch helpers ({@link getMany} / {@link setMany}) and
 * {@link getAll} ship with default implementations built on those primitives,
 * so a minimal store only needs `get` and `set`. Stores backed by a database
 * that can do batched or set-based I/O (e.g. Postgres) should override the
 * batch helpers for efficiency.
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
   * Retrieves cursors for many stream keys at once.
   *
   * Default implementation calls {@link get} once per key. Returns an empty
   * object for an empty input without issuing any reads. Keys with no stored
   * cursor map to `null`. Errors from {@link get} propagate unchanged.
   */
  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  /**
   * Stores or updates many cursors at once.
   *
   * Default implementation calls {@link set} once per entry in
   * `Object.entries` order. Returns without writing for an empty input.
   * Errors from {@link set} propagate unchanged.
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value);
    }
  }

  /**
   * Enumerates every stored cursor. Only meaningful for stores that can list
   * their contents (e.g. Postgres); the default throws because most stores
   * cannot enumerate keys. Used by {@link migrateCursors}.
   */
  async getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
    throw new Error(
      `${this.constructor.name} does not support getAll(); cursor enumeration is unavailable for this store.`,
    );
  }

  /**
   * Optional liveness probe used by the engine health check. Stores backed by
   * a network service may implement this to verify connectivity.
   */
  ping?: () => Promise<void>;
}
