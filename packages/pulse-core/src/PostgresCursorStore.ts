import type { CursorStore } from "./CursorStore.js";

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
export class PostgresCursorStore extends CursorStore {
  private readonly pg: PgLike;

  constructor(pg: PgLike) {
    super();
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

  async getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
    const result = await this.pg.query(
      "SELECT stream_key, cursor FROM cursor_store"
    );
    return result.rows.map((row: any) => ({
      streamKey: row.stream_key as string,
      cursor: row.cursor as string,
    }));
  }

  override async getMany(keys: string[]): Promise<Record<string, string | null>> {
    if (keys.length === 0) return {};

    const result = await this.pg.query(
      "SELECT stream_key, cursor FROM cursor_store WHERE stream_key = ANY($1::text[])",
      [keys]
    );

    const record: Record<string, string | null> = {};
    for (const key of keys) {
      record[key] = null;
    }
    for (const row of result.rows) {
      record[row.stream_key] = row.cursor as string;
    }
    return record;
  }

  override async setMany(entries: Record<string, string>): Promise<void> {
    const pairs = Object.entries(entries);
    if (pairs.length === 0) return;

    const streamKeys = pairs.map(([k]) => k);
    const cursors = pairs.map(([, v]) => v);

    await this.pg.query(
      `INSERT INTO cursor_store (stream_key, cursor, updated_at)
       SELECT unnest($1::text[]), unnest($2::text[]), NOW()
       ON CONFLICT (stream_key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
      [streamKeys, cursors]
    );
  }
}
