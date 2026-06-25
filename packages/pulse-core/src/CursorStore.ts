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

  /**
   * Optional liveness probe. If present, EventEngine.healthCheck() will call
   * it and report ok: false if it rejects.
   */
  ping?(): Promise<void>;

  /**
   * Returns all stored stream-key → cursor entries.
   * Used by the cursor migration utility to bulk-copy state between stores.
   */
  getAll(): Promise<Array<{ streamKey: string; cursor: string }>>;
}
