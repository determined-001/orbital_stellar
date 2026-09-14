/**
 * In-memory fake for the narrow `PgLike` client `PostgresWorkerVerdictStore`
 * calls, mirroring `stateStore.fakes.ts`'s `MockPg`: re-implements the
 * `worker_verdicts` table's real semantics (including the append-only
 * trigger and the primary-key uniqueness constraint) over a plain array, so
 * the conformance suite runs against the Postgres backend without a live
 * server while still proving it agrees with the Memory reference
 * implementation.
 */
import type { PgLike } from "../../src/verification/PostgresWorkerVerdictStore.js";

type Row = Record<string, unknown>;

export class MockPg implements PgLike {
  readonly rows: Row[] = [];

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    if (text.startsWith("INSERT INTO worker_verdicts")) {
      const [recordId] = params as [string];
      if (this.rows.some((r) => r["record_id"] === recordId)) {
        throw Object.assign(new Error(`duplicate key value violates unique constraint`), {
          code: "23505",
        });
      }
      const [
        record_id,
        schema_version,
        window_id,
        worker_id,
        operator,
        condition_ledger,
        deadline_ledger,
        status,
        invocation_ledger,
        invocation_tx_hash,
        latency_ledgers,
        engine_version,
        recorded_at,
        supersedes,
        correction_reason,
      ] = params;
      this.rows.push({
        record_id,
        schema_version,
        window_id,
        worker_id,
        operator,
        condition_ledger,
        deadline_ledger,
        status,
        invocation_ledger,
        invocation_tx_hash,
        latency_ledgers,
        engine_version,
        recorded_at,
        supersedes,
        correction_reason,
      });
      return { rows: [] };
    }

    if (text.includes("WHERE window_id = $1")) {
      const [windowId] = params as [string];
      const rows = this.rows
        .filter((r) => r["window_id"] === windowId)
        .sort((a, b) => String(a["recorded_at"]).localeCompare(String(b["recorded_at"])));
      return { rows };
    }

    if (text.includes("WHERE condition_ledger <= $1 AND deadline_ledger >= $2")) {
      const [toLedger, fromLedger] = params as [number, number];
      return {
        rows: this.rows.filter(
          (r) =>
            Number(r["condition_ledger"]) <= toLedger && Number(r["deadline_ledger"]) >= fromLedger,
        ),
      };
    }

    if (text.startsWith("SELECT * FROM worker_verdicts WHERE worker_id = $1")) {
      return { rows: this.filterByColumn("worker_id", text, params) };
    }

    if (text.startsWith("SELECT * FROM worker_verdicts WHERE operator = $1")) {
      return { rows: this.filterByColumn("operator", text, params) };
    }

    throw new Error(`MockPg: unrecognized query: ${text}`);
  }

  private filterByColumn(column: string, text: string, params: unknown[]): Row[] {
    const value = params[0];
    let rows = this.rows.filter((r) => r[column] === value);
    let paramIndex = 1;
    if (text.includes("deadline_ledger >= $")) {
      const fromLedger = params[paramIndex++] as number;
      rows = rows.filter((r) => Number(r["deadline_ledger"]) >= fromLedger);
    }
    if (text.includes("condition_ledger <= $")) {
      const toLedger = params[paramIndex++] as number;
      rows = rows.filter((r) => Number(r["condition_ledger"]) <= toLedger);
    }
    return rows;
  }
}
