/**
 * Pluggable durable store interface for the Horizon stream cursor.
 */
export interface CursorStore {
  /**
   * Retrieves the stored cursor for a given stream key.
   * Returns null if no cursor has been stored yet.
   */
  get(streamKey: string): Promise<string | null>;

  /**
   * Stores or updates the cursor for a given stream key.
   */
  set(streamKey: string, cursor: string): Promise<void>;
}

/**
 * In-memory implementation of CursorStore for testing and development.
 * Cursors are lost when the process exits.
 */
export class MemoryCursorStore implements CursorStore {
  private store: Map<string, string> = new Map();

  async get(streamKey: string): Promise<string | null> {
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.store.set(streamKey, cursor);
  }
}
