import { describe, expect, it } from "vitest";

import {
  PostgresDeadLetterStore,
  type PgLike,
  type PgQueryResult,
} from "../src/PostgresDeadLetterStore.js";

const event = {
  type: "payment.received",
  to: "GDEST",
  from: "GSRC",
  amount: "10",
  asset: "XLM",
  timestamp: "2026-04-26T12:00:00.000Z",
  raw: { id: "evt_1" },
} as const;

describe("PostgresDeadLetterStore", () => {
  it("saves dead letters through a Pg-like client", async () => {
    const queries: QueryCall[] = [];
    const pg = mockPg(queries, {
      rows: [
        {
          id: "42",
          url: "https://example.com/webhooks",
          error: "HTTP 500",
          attempts: 3,
          event: JSON.stringify(event),
          failed_at: new Date("2026-04-26T12:00:00.000Z"),
          replayed_at: null,
        },
      ],
    });

    const store = new PostgresDeadLetterStore(pg);
    const record = await store.save({
      url: "https://example.com/webhooks",
      error: "HTTP 500",
      attempts: 3,
      event,
      failedAt: "2026-04-26T12:00:00.000Z",
    });

    expect(record).toEqual({
      id: "42",
      url: "https://example.com/webhooks",
      error: "HTTP 500",
      attempts: 3,
      event,
      failedAt: "2026-04-26T12:00:00.000Z",
      replayedAt: null,
    });
    expect(queries[0]?.sql).toContain(
      'INSERT INTO "pulse_webhook_dead_letters" (url, error, attempts, event, failed_at)',
    );
    expect(queries[0]?.values).toEqual([
      "https://example.com/webhooks",
      "HTTP 500",
      3,
      JSON.stringify(event),
      "2026-04-26T12:00:00.000Z",
    ]);
  });

  it("builds index-backed URL and failed_at filters", async () => {
    const queries: QueryCall[] = [];
    const pg = mockPg(queries, { rows: [] });
    const store = new PostgresDeadLetterStore(pg);

    await store.list({
      url: "https://example.com/webhooks",
      failedAtFrom: "2026-04-26T10:00:00.000Z",
      failedAtTo: "2026-04-26T12:00:00.000Z",
      limit: 25,
      offset: 10,
    });

    expect(queries[0]?.sql).toContain("WHERE url = $1 AND failed_at >= $2 AND failed_at <= $3");
    expect(queries[0]?.sql).toContain("ORDER BY failed_at ASC, id ASC");
    expect(queries[0]?.sql).toContain("LIMIT $4 OFFSET $5");
    expect(queries[0]?.values).toEqual([
      "https://example.com/webhooks",
      "2026-04-26T10:00:00.000Z",
      "2026-04-26T12:00:00.000Z",
      25,
      10,
    ]);
  });

  it("rejects unsafe table names", () => {
    expect(
      () => new PostgresDeadLetterStore(mockPg([], { rows: [] }), "dlq;DROP TABLE users"),
    ).toThrow("Invalid Postgres identifier");
  });
});

type QueryCall = {
  sql: string;
  values?: readonly unknown[];
};

function mockPg<Row>(queries: QueryCall[], result: PgQueryResult<Row>): PgLike {
  return {
    async query<QueryRow = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      queries.push({ sql, values });
      return result as unknown as PgQueryResult<QueryRow>;
    },
  };
}
