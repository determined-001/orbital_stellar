import type { NormalizedEvent } from "@orbital/pulse-core";

export type PgQueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

export type PgLike = {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<PgQueryResult<Row>>;
};

export type DeadLetterInput = {
  url: string;
  error: string;
  attempts: number;
  event: NormalizedEvent;
  failedAt?: Date | string;
};

export type DeadLetterRecord = {
  id: string;
  url: string;
  error: string;
  attempts: number;
  event: NormalizedEvent;
  failedAt: string;
  replayedAt: string | null;
};

export type DeadLetterFilter = {
  url?: string;
  failedAtFrom?: Date | string;
  failedAtTo?: Date | string;
  replayed?: boolean;
  limit?: number;
  offset?: number;
};

export type DeadLetterStore = {
  save(record: DeadLetterInput): Promise<DeadLetterRecord>;
  put(record: DeadLetterInput): Promise<DeadLetterRecord>;
  list(filter?: DeadLetterFilter): Promise<DeadLetterRecord[]>;
  get(id: string): Promise<DeadLetterRecord | null>;
  markReplayed(
    id: string,
    replayedAt?: Date | string,
  ): Promise<DeadLetterRecord | null>;
  delete(id: string): Promise<boolean>;
};

type DeadLetterRow = {
  id: string | number;
  url: string;
  error: string;
  attempts: number;
  event: NormalizedEvent | string;
  failed_at: Date | string;
  replayed_at: Date | string | null;
};

export class PostgresDeadLetterStore implements DeadLetterStore {
  private readonly tableSql: string;

  constructor(
    private readonly pg: PgLike,
    tableName = "pulse_webhook_dead_letters",
  ) {
    this.tableSql = quoteIdentifierPath(tableName);
  }

  async save(record: DeadLetterInput): Promise<DeadLetterRecord> {
    const failedAt = record.failedAt ?? new Date();
    const result = await this.pg.query<DeadLetterRow>(
      `INSERT INTO ${this.tableSql} (url, error, attempts, event, failed_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, url, error, attempts, event, failed_at, replayed_at`,
      [
        record.url,
        record.error,
        record.attempts,
        JSON.stringify(record.event),
        normalizeDateInput(failedAt),
      ],
    );

    return mapRow(requireRow(result));
  }

  async put(record: DeadLetterInput): Promise<DeadLetterRecord> {
    return this.save(record);
  }

  async list(filter: DeadLetterFilter = {}): Promise<DeadLetterRecord[]> {
    const values: unknown[] = [];
    const where: string[] = [];

    if (filter.url) {
      values.push(filter.url);
      where.push(`url = $${values.length}`);
    }

    if (filter.failedAtFrom) {
      values.push(normalizeDateInput(filter.failedAtFrom));
      where.push(`failed_at >= $${values.length}`);
    }

    if (filter.failedAtTo) {
      values.push(normalizeDateInput(filter.failedAtTo));
      where.push(`failed_at <= $${values.length}`);
    }

    if (filter.replayed === true) {
      where.push("replayed_at IS NOT NULL");
    } else if (filter.replayed === false) {
      where.push("replayed_at IS NULL");
    }

    const limit = clampInteger(filter.limit, 100, 1, 1000);
    const offset = clampInteger(filter.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    values.push(limit, offset);

    const result = await this.pg.query<DeadLetterRow>(
      `SELECT id, url, error, attempts, event, failed_at, replayed_at
       FROM ${this.tableSql}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY failed_at ASC, id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return result.rows.map(mapRow);
  }

  async get(id: string): Promise<DeadLetterRecord | null> {
    const result = await this.pg.query<DeadLetterRow>(
      `SELECT id, url, error, attempts, event, failed_at, replayed_at
       FROM ${this.tableSql}
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async markReplayed(
    id: string,
    replayedAt: Date | string = new Date(),
  ): Promise<DeadLetterRecord | null> {
    const result = await this.pg.query<DeadLetterRow>(
      `UPDATE ${this.tableSql}
       SET replayed_at = $2
       WHERE id = $1
       RETURNING id, url, error, attempts, event, failed_at, replayed_at`,
      [id, normalizeDateInput(replayedAt)],
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pg.query(
      `DELETE FROM ${this.tableSql}
       WHERE id = $1`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function quoteIdentifierPath(identifierPath: string): string {
  return identifierPath
    .split(".")
    .map((identifier) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
        throw new Error(`Invalid Postgres identifier: ${identifier}`);
      }

      return `"${identifier}"`;
    })
    .join(".");
}

function requireRow(result: PgQueryResult<DeadLetterRow>): DeadLetterRow {
  const row = result.rows[0];
  if (!row) throw new Error("Postgres dead-letter insert did not return a row");
  return row;
}

function mapRow(row: DeadLetterRow): DeadLetterRecord {
  return {
    id: String(row.id),
    url: row.url,
    error: row.error,
    attempts: row.attempts,
    event: normalizeEventOutput(row.event),
    failedAt: normalizeDateOutput(row.failed_at),
    replayedAt: row.replayed_at ? normalizeDateOutput(row.replayed_at) : null,
  };
}

function normalizeEventOutput(value: NormalizedEvent | string): NormalizedEvent {
  return typeof value === "string"
    ? (JSON.parse(value) as NormalizedEvent)
    : value;
}

function normalizeDateInput(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeDateOutput(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
