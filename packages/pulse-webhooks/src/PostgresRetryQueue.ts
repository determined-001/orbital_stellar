import type { RetryQueue, RetryRecord } from "./types.js";

export interface PgLike {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
}

export interface PostgresRetryQueueOptions {
  /** The name of the table to use for the retry queue. Defaults to "orbital_retry_queue" */
  tableName?: string;
}

/**
 * PostgresRetryQueue — A high-performance Postgres-backed retry queue
 * 
 * DESIGN & MULTI-CONSUMER BEHAVIOR:
 * 
 * 1. Safe Multi-Consumer Dequeue:
 *    The dequeue operation utilizes the `SELECT ... FOR UPDATE SKIP LOCKED` query pattern.
 *    In a multi-threaded or multi-server setup where multiple consumers/workers query the database
 *    simultaneously:
 *    - `FOR UPDATE` places an exclusive write lock on the selected rows.
 *    - `SKIP LOCKED` instructs Postgres to skip any rows that are already locked by other transactions.
 *    - This guarantees that no two consumers can dequeue or lease the same record simultaneously,
 *      resulting in strict exactly-once processing per lease.
 * 
 * 2. Atomic Lock Leases (CTE):
 *    To minimize database round-trips and maximize throughput, the selection, locking, and leasing
 *    occur in a single atomic SQL transaction using a Common Table Expression (CTE):
 *    - Select up to `limit` due jobs.
 *    - Lock them with `FOR UPDATE SKIP LOCKED`.
 *    - Update their `locked_until` lease timestamp to protect them from other workers.
 *    - Return the leased jobs immediately to the worker.
 * 
 * 3. Crash Recovery & Visibility Timeout:
 *    Each dequeued job is leased for `leaseDurationMs` (setting `locked_until`). If a worker
 *    successfully processes the job, it calls `complete(id)`, deleting the record.
 *    If a worker crashes, stalls, or fails to complete the job within the lease window, the job's
 *    `locked_until` timestamp naturally expires. It will automatically become eligible for dequeue
 *    by another healthy worker during the next poll, providing robust crash-recovery.
 */
export class PostgresRetryQueue implements RetryQueue {
  private pg: PgLike;
  private tableName: string;

  constructor(pg: PgLike, options: PostgresRetryQueueOptions = {}) {
    this.pg = pg;
    this.tableName = options.tableName || "orbital_retry_queue";
  }

  /**
   * Overloaded enqueue to support both the standard RetryQueue interface and legacy postgres signature.
   */
  async enqueue(record: RetryRecord): Promise<void>;
  async enqueue(url: string, event: any, attempt: number, nextAttemptAt: Date): Promise<void>;
  async enqueue(
    recordOrUrl: RetryRecord | string,
    event?: any,
    attempt?: number,
    nextAttemptAt?: Date
  ): Promise<void> {
    if (typeof recordOrUrl === "object" && recordOrUrl !== null) {
      // New RetryQueue interface signature
      const record = recordOrUrl as RetryRecord;
      const queryText = `
        INSERT INTO ${this.tableName} (url, event, attempt, next_attempt_at)
        VALUES ($1, $2, $3, $4)
      `;
      await this.pg.query(queryText, [
        record.url,
        JSON.stringify(record.event),
        record.attempt,
        new Date(record.nextAttemptAt),
      ]);
    } else {
      // Legacy Postgres-specific signature
      const queryText = `
        INSERT INTO ${this.tableName} (url, event, attempt, next_attempt_at)
        VALUES ($1, $2, $3, $4)
      `;
      await this.pg.query(queryText, [recordOrUrl, JSON.stringify(event), attempt, nextAttemptAt]);
    }
  }

  /**
   * Overloaded dequeue to support both the standard RetryQueue interface and legacy postgres signature.
   */
  async dequeue(): Promise<RetryRecord | null>;
  async dequeue(limit: number, leaseDurationMs: number): Promise<any[]>;
  async dequeue(limitOrUndefined?: number, leaseDurationMs?: number): Promise<any> {
    if (limitOrUndefined === undefined) {
      // New RetryQueue interface signature (leases oldest due record)
      const leaseMs = 30000;
      const lockedUntil = new Date(Date.now() + leaseMs);
      const queryText = `
        WITH next_jobs AS (
          SELECT id
          FROM ${this.tableName}
          WHERE next_attempt_at <= NOW()
            AND (locked_until IS NULL OR locked_until < NOW())
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${this.tableName}
        SET locked_until = $1
        WHERE id IN (SELECT id FROM next_jobs)
        RETURNING id, url, event, attempt, next_attempt_at
      `;
      const result = await this.pg.query(queryText, [lockedUntil]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        url: row.url,
        event: typeof row.event === "string" ? JSON.parse(row.event) : row.event,
        attempt: row.attempt,
        nextAttemptAt: new Date(row.next_attempt_at).getTime(),
      };
    } else {
      // Legacy Postgres-specific signature
      const limit = limitOrUndefined;
      const leaseMs = leaseDurationMs || 30000;
      const lockedUntil = new Date(Date.now() + leaseMs);
      const queryText = `
        WITH next_jobs AS (
          SELECT id
          FROM ${this.tableName}
          WHERE next_attempt_at <= NOW()
            AND (locked_until IS NULL OR locked_until < NOW())
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${this.tableName}
        SET locked_until = $2
        WHERE id IN (SELECT id FROM next_jobs)
        RETURNING id, url, event, attempt
      `;
      const result = await this.pg.query(queryText, [limit, lockedUntil]);
      return result.rows.map(row => ({
        id: row.id,
        url: row.url,
        event: typeof row.event === "string" ? JSON.parse(row.event) : row.event,
        attempt: row.attempt,
      }));
    }
  }

  /**
   * Evicts (removes and returns) the newest (last-inserted) record from the queue (LIFO).
   */
  async evictNewest(): Promise<RetryRecord | null> {
    const queryText = `
      DELETE FROM ${this.tableName}
      WHERE id = (
        SELECT id
        FROM ${this.tableName}
        ORDER BY id DESC
        LIMIT 1
      )
      RETURNING id, url, event, attempt, next_attempt_at
    `;
    const result = await this.pg.query(queryText);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      url: row.url,
      event: typeof row.event === "string" ? JSON.parse(row.event) : row.event,
      attempt: row.attempt,
      nextAttemptAt: new Date(row.next_attempt_at).getTime(),
    };
  }

  /**
   * Returns the current number of items in the queue.
   */
  async size(): Promise<number> {
    const queryText = `SELECT COUNT(*)::int as count FROM ${this.tableName}`;
    const result = await this.pg.query(queryText);
    return result.rows[0]?.count || 0;
  }

  /**
   * Marks a job as completed, removing it from the queue.
   * Exposed for legacy multi-consumer queries.
   */
  async complete(id: string | number): Promise<void> {
    const queryText = `DELETE FROM ${this.tableName} WHERE id = $1`;
    await this.pg.query(queryText, [id]);
  }

  /**
   * Registers a job failure. Reschedules the next attempt or deletes if retries are exhausted.
   * Exposed for legacy multi-consumer queries.
   */
  async fail(id: string | number, nextAttemptAt: Date | null): Promise<void> {
    if (nextAttemptAt === null) {
      // Exceeded max attempts, delete from queue
      const queryText = `DELETE FROM ${this.tableName} WHERE id = $1`;
      await this.pg.query(queryText, [id]);
    } else {
      // Reschedule for next attempt and clear the lock lease
      const queryText = `
        UPDATE ${this.tableName}
        SET attempt = attempt + 1,
            next_attempt_at = $2,
            locked_until = NULL
        WHERE id = $1
      `;
      await this.pg.query(queryText, [id, nextAttemptAt]);
    }
  }
}
