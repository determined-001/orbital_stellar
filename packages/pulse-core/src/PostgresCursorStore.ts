import { CursorStore } from "./CursorStore.js";

/**
 * Minimal interface required from a PostgreSQL client.
 * Compatible with `pg` Pool or Client.
 */
export interface PgLike {
  /**
   * Execute a query with optional parameters.
   * Should return an object with a `rows` field containing result rows.
   */
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
}

/**
 * PostgreSQL implementation of {@link CursorStore}.
 * Stores a cursor per `stream_key` with an upsert strategy.
 */
export class PostgresCursorStore implements CursorStore {
  private readonly pg: PgLike;

  constructor(pg: PgLike) {
    this.pg = pg;
  }

  async get(streamKey: string): Promise<string | null> {
    const result = await this.pg.query(
      "SELECT cursor FROM cursor_store WHERE stream_key = $1",
      [streamKey]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].cursor as string;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    await this.pg.query(
      `INSERT INTO cursor_store (stream_key, cursor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stream_key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW();`,
      [streamKey, cursor]
    );
  }
}
