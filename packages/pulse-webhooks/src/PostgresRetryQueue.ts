import type { RetryRecord } from "./RetryQueue.js";

export interface PgLike {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Postgres-backed retry queue that satisfies the {@link RetryQueue} contract.
 *
 * ## Async Extension Note
 *
 * The base `RetryQueue` interface defines synchronous methods (`void`,
 * `RetryRecord | undefined`, `number`). PostgresRetryQueue is an **async
 * extension** — every public method returns a `Promise` wrapping the
 * corresponding return type. The method signatures and semantics are identical
 * otherwise. Consumers that need to swap between `MemoryRetryQueue` and
 * `PostgresRetryQueue` should `await` all calls; this works with both
 * implementations (`await` on a synchronous method is a harmless micro-tick).
 *
 * ## Multi-Consumer Dequeue (`SELECT ... FOR UPDATE SKIP LOCKED`)
 *
 * The `dequeue()` method uses a single-statement CTE that atomically:
 * 1. Selects one due record (`next_retry_at <= NOW()`)
 * 2. Locks it with `FOR UPDATE SKIP LOCKED`
 * 3. Deletes it via `RETURNING`
 *
 * This guarantees:
 * - **Exactly-once processing** – `SKIP LOCKED` skips rows already locked by
 *   another transaction, so no two consumers ever receive the same record.
 * - **No lock gap** – Because the SELECT and DELETE execute in a single CTE
 *   statement, a crash between the two operations is impossible. The lock is
 *   held only for the duration of that single statement, not across round-trips.
 * - **No head-of-line blocking** – `SKIP LOCKED` lets other consumers bypass
 *   locked rows and proceed to the next available due record.
 *
 * ## Idempotent Enqueue
 *
 * `enqueue()` uses `ON CONFLICT (id) DO NOTHING` – calling it with the same
 * record ID multiple times inserts exactly one row.
 *
 * ## Usage
 *
 * ```ts
 * import pg from "pg";
 * import { PostgresRetryQueue } from "@orbital/pulse-webhooks";
 *
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 * const queue = new PostgresRetryQueue(pool);
 * const record = await queue.dequeue();
 * ```
 *
 * Any pg-compatible client that satisfies the {@link PgLike} interface
 * (node-postgres, postgres.js, Bun SQL, etc.) is accepted.
 */
export class PostgresRetryQueue {
  private pg: PgLike;
  private tableName: string;

  constructor(pg: PgLike, tableName = "retry_queue") {
    this.pg = pg;
    this.tableName = tableName;
  }

  async enqueue(record: RetryRecord): Promise<void> {
    const sql = `
      INSERT INTO ${this.tableName}
        (id, webhook_id, payload, attempt_count, next_retry_at, created_at, url, event, attempt, last_error, metadata)
      VALUES
        (COALESCE($1, gen_random_uuid()::text), $2, $3::jsonb, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), $7, $8::jsonb, $9, $10, $11::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
    await this.pg.query(sql, [
      record.id ?? null,
      record.webhookId,
      JSON.stringify(record.payload),
      record.attemptCount,
      record.nextRetryAt,
      record.createdAt,
      record.url,
      JSON.stringify(record.event),
      record.attempt,
      record.lastError ?? null,
      record.metadata !== undefined ? JSON.stringify(record.metadata) : null,
    ]);
  }

  async dequeue(): Promise<RetryRecord | undefined> {
    const sql = `
      WITH next_job AS (
        SELECT id
        FROM ${this.tableName}
        WHERE next_retry_at <= NOW()
        ORDER BY next_retry_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${this.tableName}
      WHERE id = (SELECT id FROM next_job)
      RETURNING id, webhook_id, payload, attempt_count, next_retry_at, created_at, url, event, attempt, last_error, metadata
    `;
    const result = await this.pg.query(sql);
    if (result.rows.length === 0) return undefined;
    return this.toRecord(result.rows[0]);
  }

  async evictNewest(): Promise<RetryRecord | undefined> {
    const sql = `
      DELETE FROM ${this.tableName}
      WHERE id = (
        SELECT id FROM ${this.tableName}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      )
      RETURNING id, webhook_id, payload, attempt_count, next_retry_at, created_at, url, event, attempt, last_error, metadata
    `;
    const result = await this.pg.query(sql);
    if (result.rows.length === 0) return undefined;
    return this.toRecord(result.rows[0]);
  }

  async size(): Promise<number> {
    const result = await this.pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${this.tableName}`,
    );
    return result.rows[0]?.count ?? 0;
  }

  private toRecord(row: any): RetryRecord {
    return {
      id: row.id ?? undefined,
      webhookId: row.webhook_id,
      payload:
        typeof row.payload === "string"
          ? JSON.parse(row.payload)
          : row.payload,
      attemptCount: row.attempt_count,
      nextRetryAt:
        typeof row.next_retry_at === "number"
          ? row.next_retry_at
          : new Date(row.next_retry_at).getTime(),
      createdAt:
        typeof row.created_at === "number"
          ? row.created_at
          : new Date(row.created_at).getTime(),
      url: row.url,
      event:
        typeof row.event === "string" ? JSON.parse(row.event) : row.event,
      attempt: row.attempt,
      lastError: row.last_error ?? undefined,
      metadata: row.metadata
        ? typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata
        : undefined,
    };
  }
}
