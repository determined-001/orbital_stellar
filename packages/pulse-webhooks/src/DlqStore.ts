import type { NormalizedEvent } from "@orbital/pulse-core";
import type { DlqEntry, PgClient } from "./dlq.types.js";

export class DlqStore {
  constructor(private readonly db: PgClient) {}

  /** Persist a failed delivery to the DLQ. */
  async push(
    address: string,
    url: string,
    attempts: number,
    error: string,
    payload: NormalizedEvent
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO dlq_events (address, url, attempts, last_error, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [address, url, attempts, error, JSON.stringify(payload)]
    );
  }

  /** List DLQ entries, optionally filtered by created_at >= since. */
  async list(since?: string): Promise<DlqEntry[]> {
    const { rows } = await this.db.query<DlqEntry>(
      `SELECT id, address, url, attempts, last_error, payload, created_at, replayed_at
       FROM dlq_events
       WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       ORDER BY created_at DESC`,
      [since ?? null]
    );
    return rows;
  }

  /** Return all DLQ entries (no filter). */
  async dump(): Promise<DlqEntry[]> {
    const { rows } = await this.db.query<DlqEntry>(
      `SELECT id, address, url, attempts, last_error, payload, created_at, replayed_at
       FROM dlq_events
       ORDER BY created_at DESC`
    );
    return rows;
  }

  /** Mark an entry as replayed and return its payload for re-delivery. */
  async markReplayed(id: string): Promise<NormalizedEvent | null> {
    const { rows } = await this.db.query<DlqEntry>(
      `UPDATE dlq_events
       SET replayed_at = NOW()
       WHERE id = $1 AND replayed_at IS NULL
       RETURNING payload`,
      [id]
    );
    return rows[0]?.payload ?? null;
  }
}
