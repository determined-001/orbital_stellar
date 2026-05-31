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
