/**
 * CursorStore provides an abstraction for persisting stream cursors so
 * a restarted process can resume from the last seen position.
 */
export interface CursorStore {
  /**
   * Return the last stored cursor for `streamKey` or `null` when none exists.
   */
  get(streamKey: string): Promise<string | null>;

  /**
   * Persist the cursor value for `streamKey`.
   */
  set(streamKey: string, cursor: string): Promise<void>;
}

/**
 * MemoryCursorStore is an in-memory reference implementation of CursorStore
 * intended for tests and ephemeral usage. It is NOT durable across process
 * restarts.
 */
export class MemoryCursorStore implements CursorStore {
  private readonly store = new Map<string, string>();

  async get(streamKey: string): Promise<string | null> {
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.store.set(streamKey, cursor);
  }
}
