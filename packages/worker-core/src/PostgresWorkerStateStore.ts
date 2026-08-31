import {
  WorkerStateStore,
  WORKER_STATE_SCHEMA_VERSION,
  type WorkerState,
  type RegisterWorkerInput,
  type AppendFireRecordInput,
  type WriteClaimInput,
  type ReleaseClaimInput,
  type WorkerFireRecord,
  type WorkerClaimRecord,
} from "./WorkerStateStore.js";

/**
 * Minimal interface required from a PostgreSQL client.
 * Compatible with `pg` Pool or Client.
 */
export interface PgLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * PostgreSQL implementation of {@link WorkerStateStore}.
 *
 * Uses three tables (see `migrations/001_worker_state_store.sql`):
 *
 * - `worker_registrations` — one row per worker, holds the mutable scalars
 * - `worker_fire_history`  — append-only fire records (INSERT-only policy enforced
 *   by a per-table trigger shipped in the migration)
 * - `worker_claims`        — active claim records, replaced on renew
 *
 * ## Concurrency safety
 *
 * `registerWorker` uses `INSERT … ON CONFLICT DO NOTHING` so that concurrent
 * callers from multiple processes converge without error.
 *
 * `writeClaim` uses `INSERT … ON CONFLICT (worker_id, window_id) DO UPDATE`
 * so that a single window can only have one active claim per worker.
 *
 * ## Fire-history integrity
 *
 * The migration ships a `BEFORE UPDATE OR DELETE` trigger on
 * `worker_fire_history` that raises an exception, making the append-only
 * invariant enforced at the database level independently of application code.
 */
export class PostgresWorkerStateStore extends WorkerStateStore {
  readonly #pg: PgLike;

  constructor(pg: PgLike) {
    super();
    this.#pg = pg;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Reconstitutes a full WorkerState from the three tables. */
  async #load(workerId: string): Promise<WorkerState | null> {
    const reg = await this.#pg.query(
      `SELECT worker_id, registered_at, updated_at,
              last_fired_window_start, last_fired_window_end, metadata
       FROM worker_registrations WHERE worker_id = $1`,
      [workerId],
    );
    if (reg.rows.length === 0) return null;
    const row = reg.rows[0]!;

    const history = await this.#pg.query(
      `SELECT window_start, window_end, fired_at, payload
       FROM worker_fire_history WHERE worker_id = $1 ORDER BY fired_at ASC`,
      [workerId],
    );

    const claims = await this.#pg.query(
      `SELECT window_id, worker_id, claimed_at, expires_at
       FROM worker_claims WHERE worker_id = $1`,
      [workerId],
    );

    const fireHistory: WorkerFireRecord[] = history.rows.map((r) => ({
      windowStart: r["window_start"] as string,
      windowEnd: r["window_end"] as string,
      firedAt: r["fired_at"] as string,
      payload: r["payload"] ?? undefined,
    }));

    const activeClaims: WorkerClaimRecord[] = claims.rows.map((r) => ({
      windowId: r["window_id"] as string,
      workerId: r["worker_id"] as string,
      claimedAt: r["claimed_at"] as string,
      expiresAt: r["expires_at"] as string,
    }));

    return {
      schemaVersion: WORKER_STATE_SCHEMA_VERSION,
      workerId: row["worker_id"] as string,
      registeredAt: row["registered_at"] as string,
      updatedAt: row["updated_at"] as string,
      lastFiredWindowStart: (row["last_fired_window_start"] as string | null) ?? null,
      lastFiredWindowEnd: (row["last_fired_window_end"] as string | null) ?? null,
      fireHistory,
      activeClaims,
      metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // WorkerStateStore interface
  // -------------------------------------------------------------------------

  async getWorker(workerId: string): Promise<WorkerState | null> {
    return this.#load(workerId);
  }

  async registerWorker(input: RegisterWorkerInput): Promise<WorkerState> {
    const now = new Date().toISOString();
    const registeredAt = input.registeredAt ?? now;
    const metadata = JSON.stringify(input.metadata ?? {});

    await this.#pg.query(
      `INSERT INTO worker_registrations
         (worker_id, registered_at, updated_at, last_fired_window_start, last_fired_window_end, metadata)
       VALUES ($1, $2, $3, NULL, NULL, $4::jsonb)
       ON CONFLICT (worker_id) DO NOTHING`,
      [input.workerId, registeredAt, now, metadata],
    );

    // Load the authoritative record (handles both INSERT and DO NOTHING paths)
    const state = await this.#load(input.workerId);
    if (!state) {
      // Should never happen: we just inserted or it already existed
      throw new Error(
        `PostgresWorkerStateStore: failed to load worker "${input.workerId}" after registration.`,
      );
    }
    return state;
  }

  async appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState> {
    const existing = await this.#pg.query(
      "SELECT 1 FROM worker_registrations WHERE worker_id = $1",
      [input.workerId],
    );
    if (existing.rows.length === 0) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const payload =
      input.record.payload !== undefined ? JSON.stringify(input.record.payload) : null;

    // Append to fire history (insert-only; the DB trigger prevents updates/deletes)
    await this.#pg.query(
      `INSERT INTO worker_fire_history (worker_id, window_start, window_end, fired_at, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.workerId,
        input.record.windowStart,
        input.record.windowEnd,
        input.record.firedAt,
        payload,
      ],
    );

    // Update the mutable scalars on the registration row
    await this.#pg.query(
      `UPDATE worker_registrations
       SET updated_at = $1, last_fired_window_start = $2, last_fired_window_end = $3
       WHERE worker_id = $4`,
      [now, input.record.windowStart, input.record.windowEnd, input.workerId],
    );

    const state = await this.#load(input.workerId);
    return state!;
  }

  async writeClaim(input: WriteClaimInput): Promise<WorkerState> {
    const existing = await this.#pg.query(
      "SELECT 1 FROM worker_registrations WHERE worker_id = $1",
      [input.workerId],
    );
    if (existing.rows.length === 0) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    await this.#pg.query(
      `INSERT INTO worker_claims (window_id, worker_id, claimed_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (worker_id, window_id)
         DO UPDATE SET claimed_at = EXCLUDED.claimed_at, expires_at = EXCLUDED.expires_at`,
      [input.claim.windowId, input.workerId, input.claim.claimedAt, input.claim.expiresAt],
    );

    await this.#pg.query("UPDATE worker_registrations SET updated_at = $1 WHERE worker_id = $2", [
      now,
      input.workerId,
    ]);

    const state = await this.#load(input.workerId);
    return state!;
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<WorkerState> {
    // Existence check so we can return a valid state even if the claim is absent
    const existing = await this.#pg.query(
      "SELECT 1 FROM worker_registrations WHERE worker_id = $1",
      [input.workerId],
    );
    if (existing.rows.length === 0) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    await this.#pg.query("DELETE FROM worker_claims WHERE worker_id = $1 AND window_id = $2", [
      input.workerId,
      input.windowId,
    ]);

    await this.#pg.query("UPDATE worker_registrations SET updated_at = $1 WHERE worker_id = $2", [
      now,
      input.workerId,
    ]);

    const state = await this.#load(input.workerId);
    return state!;
  }

  override async getAllWorkers(): Promise<WorkerState[]> {
    const reg = await this.#pg.query(
      "SELECT worker_id FROM worker_registrations ORDER BY registered_at ASC",
    );
    const workers: WorkerState[] = [];
    for (const row of reg.rows) {
      const state = await this.#load(row["worker_id"] as string);
      if (state) workers.push(state);
    }
    return workers;
  }

  override ping = async (): Promise<void> => {
    await this.#pg.query("SELECT 1");
  };
}
