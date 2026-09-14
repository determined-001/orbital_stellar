import {
  WorkerFireVerdictStore,
  DuplicateVerdictRecordError,
  type WorkerVerdictRecord,
  type WorkerVerdictQueryOptions,
} from "./WorkerFireVerdictStore.js";
import type { WorkerFireVerdictStatus } from "./workerFireVerdict.js";

/** Minimal interface required from a PostgreSQL client. Compatible with `pg` Pool or Client. */
export interface PgLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Postgres unique_violation. Raised when a repeated `record_id` hits the primary key. */
const UNIQUE_VIOLATION = "23505";

type PgRow = {
  record_id: string;
  schema_version: number;
  window_id: string;
  worker_id: string;
  operator: string;
  condition_ledger: string | number;
  deadline_ledger: string | number;
  status: WorkerFireVerdictStatus;
  invocation_ledger: string | number | null;
  invocation_tx_hash: string | null;
  latency_ledgers: string | number | null;
  engine_version: string;
  recorded_at: string;
  supersedes: string | null;
  correction_reason: string | null;
};

function rowToRecord(row: PgRow): WorkerVerdictRecord {
  return {
    recordId: row.record_id,
    schemaVersion: row.schema_version as WorkerVerdictRecord["schemaVersion"],
    windowId: row.window_id,
    workerId: row.worker_id,
    operator: row.operator,
    conditionLedger: Number(row.condition_ledger),
    deadlineLedger: Number(row.deadline_ledger),
    status: row.status,
    ...(row.invocation_ledger !== null ? { invocationLedger: Number(row.invocation_ledger) } : {}),
    ...(row.invocation_tx_hash !== null ? { invocationTxHash: row.invocation_tx_hash } : {}),
    ...(row.latency_ledgers !== null ? { latencyLedgers: Number(row.latency_ledgers) } : {}),
    engineVersion: row.engine_version,
    recordedAt: row.recorded_at,
    ...(row.supersedes !== null ? { supersedes: row.supersedes } : {}),
    ...(row.correction_reason !== null ? { correctionReason: row.correction_reason } : {}),
  };
}

/**
 * PostgreSQL implementation of {@link WorkerFireVerdictStore}.
 *
 * Uses one table, `worker_verdicts` (see `migrations/002_worker_verdicts.sql`),
 * with a `BEFORE UPDATE OR DELETE` trigger enforcing append-only at the
 * database level, mirroring `PostgresWorkerStateStore`'s fire-history table.
 */
export class PostgresWorkerVerdictStore extends WorkerFireVerdictStore {
  readonly #pg: PgLike;

  constructor(pg: PgLike) {
    super();
    this.#pg = pg;
  }

  protected async _write(record: WorkerVerdictRecord): Promise<void> {
    try {
      await this.#pg.query(
        `INSERT INTO worker_verdicts
           (record_id, schema_version, window_id, worker_id, operator,
            condition_ledger, deadline_ledger, status, invocation_ledger,
            invocation_tx_hash, latency_ledgers, engine_version, recorded_at,
            supersedes, correction_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          record.recordId,
          record.schemaVersion,
          record.windowId,
          record.workerId,
          record.operator,
          record.conditionLedger,
          record.deadlineLedger,
          record.status,
          record.invocationLedger ?? null,
          record.invocationTxHash ?? null,
          record.latencyLedgers ?? null,
          record.engineVersion,
          record.recordedAt,
          record.supersedes ?? null,
          record.correctionReason ?? null,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateVerdictRecordError(record.recordId);
      throw err;
    }
  }

  async getLatestForWindow(windowId: string): Promise<WorkerVerdictRecord | null> {
    const history = await this.getHistoryForWindow(windowId);
    return latestOf(history);
  }

  async getHistoryForWindow(windowId: string): Promise<WorkerVerdictRecord[]> {
    const result = await this.#pg.query(
      `SELECT * FROM worker_verdicts WHERE window_id = $1 ORDER BY recorded_at ASC`,
      [windowId],
    );
    return result.rows.map((r) => rowToRecord(r as unknown as PgRow));
  }

  async queryByWorker(
    workerId: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]> {
    return this.queryBy("worker_id", workerId, options);
  }

  async queryByOperator(
    operator: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]> {
    return this.queryBy("operator", operator, options);
  }

  async queryByLedgerRange(
    fromLedger: number,
    toLedger: number,
    options?: Omit<WorkerVerdictQueryOptions, "fromLedger" | "toLedger">,
  ): Promise<WorkerVerdictRecord[]> {
    return this.runLatestOnlyAwareQuery(
      `SELECT * FROM worker_verdicts WHERE condition_ledger <= $1 AND deadline_ledger >= $2`,
      [toLedger, fromLedger],
      options?.latestOnly ?? true,
    );
  }

  private async queryBy(
    column: "worker_id" | "operator",
    value: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]> {
    const conditions = [`${column} = $1`];
    const params: unknown[] = [value];
    if (options?.fromLedger !== undefined) {
      params.push(options.fromLedger);
      conditions.push(`deadline_ledger >= $${params.length}`);
    }
    if (options?.toLedger !== undefined) {
      params.push(options.toLedger);
      conditions.push(`condition_ledger <= $${params.length}`);
    }
    return this.runLatestOnlyAwareQuery(
      `SELECT * FROM worker_verdicts WHERE ${conditions.join(" AND ")}`,
      params,
      options?.latestOnly ?? true,
    );
  }

  /**
   * Runs `sql`/`params`, then - when `latestOnly` - collapses the result to
   * one record per `window_id` by following each matched window's full
   * supersession chain (a second, targeted query per distinct window
   * rather than trying to express "latest, possibly superseded elsewhere"
   * in one SQL statement).
   */
  private async runLatestOnlyAwareQuery(
    sql: string,
    params: unknown[],
    latestOnly: boolean,
  ): Promise<WorkerVerdictRecord[]> {
    const result = await this.#pg.query(sql, params);
    const records = result.rows.map((r) => rowToRecord(r as unknown as PgRow));
    if (!latestOnly) return records;

    const windowIds = [...new Set(records.map((r) => r.windowId))];
    const latest: WorkerVerdictRecord[] = [];
    for (const windowId of windowIds) {
      const resolved = await this.getLatestForWindow(windowId);
      if (resolved) latest.push(resolved);
    }
    return latest;
  }
}

function latestOf(history: ReadonlyArray<WorkerVerdictRecord>): WorkerVerdictRecord | null {
  if (history.length === 0) return null;
  const superseded = new Set(history.filter((r) => r.supersedes).map((r) => r.supersedes));
  const notSuperseded = history.filter((r) => !superseded.has(r.recordId));
  notSuperseded.sort((a, b) => {
    const byTime = a.recordedAt.localeCompare(b.recordedAt);
    return byTime !== 0 ? byTime : a.recordId.localeCompare(b.recordId);
  });
  return notSuperseded[notSuperseded.length - 1] ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}
