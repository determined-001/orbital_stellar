import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresCursorStore } from "../src/PostgresCursorStore.js";
import type { PgLike } from "../src/PostgresCursorStore.js";
import fs from "fs";
import path from "path";

describe("PostgresCursorStore Integration Test", () => {
  const isIntegrationTest = process.env.INTEGRATION_TESTS === "true";

  // Skip all tests in this suite if not running integration tests
  if (!isIntegrationTest) {
    it("skipping PostgresCursorStore integration tests (INTEGRATION_TESTS is not true)", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const connectionString =
    process.env.PG_TEST_URL || "postgres://postgres:postgres@localhost:5432/postgres";

  let pool: any;
  let store: PostgresCursorStore;

  beforeAll(async () => {
    // Dynamic import so the pg package is only required when running integration tests
    const pg = await import("pg");
    pool = new pg.default.Pool({ connectionString });
    store = new PostgresCursorStore(pool);

    // Run the migration SQL file to set up the test database table
    const migrationPath = path.resolve(__dirname, "../migrations/001_cursor_store.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    await pool.query(migrationSql);
  });

  afterAll(async () => {
    if (pool) {
      // Clean up test rows
      await pool.query("DELETE FROM cursor_store WHERE stream_key LIKE $1", ["test-stream-%"]);
      await pool.end();
    }
  });

  it("should return null when getting a non-existent cursor", async () => {
    const cursor = await store.get("test-stream-nonexistent");
    expect(cursor).toBeNull();
  });

  it("should insert a new cursor on set and retrieve it on get", async () => {
    const streamKey = "test-stream-1";
    const cursorVal = "12345678";

    await store.set(streamKey, cursorVal);

    const retrieved = await store.get(streamKey);
    expect(retrieved).toBe(cursorVal);
  });

  it("should upsert the cursor on set when it already exists", async () => {
    const streamKey = "test-stream-2";
    const cursor1 = "first-cursor";
    const cursor2 = "second-cursor";

    await store.set(streamKey, cursor1);
    const retrieved1 = await store.get(streamKey);
    expect(retrieved1).toBe(cursor1);

    await store.set(streamKey, cursor2);
    const retrieved2 = await store.get(streamKey);
    expect(retrieved2).toBe(cursor2);

    // Verify row count in database to ensure it upserted instead of creating multiple rows
    const res = await pool.query("SELECT COUNT(*) FROM cursor_store WHERE stream_key = $1", [
      streamKey,
    ]);
    expect(parseInt(res.rows[0].count, 10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for getMany / setMany — no real Postgres required
// ---------------------------------------------------------------------------

describe("PostgresCursorStore unit tests (mock PgLike)", () => {
  // Helper to build a mock PgLike that records every query call.
  function makeMockPg(rows: Array<{ stream_key: string; cursor: string }> = []): {
    pg: PgLike;
    calls: Array<{ text: string; params: any[] | undefined }>;
  } {
    const calls: Array<{ text: string; params: any[] | undefined }> = [];
    const mockPg: PgLike = {
      query: async (text: string, params?: any[]) => {
        calls.push({ text, params });
        return { rows };
      },
    };
    return { pg: mockPg, calls };
  }

  // -------------------------------------------------------------------------
  // getMany
  // -------------------------------------------------------------------------

  it("getMany with empty array returns {} and issues no query", async () => {
    const { pg: mockPg, calls } = makeMockPg();
    const store = new PostgresCursorStore(mockPg);

    const result = await store.getMany([]);

    expect(result).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("getMany with N keys issues exactly one query and maps rows to values", async () => {
    const rows = [
      { stream_key: "key-a", cursor: "cursor-a" },
      { stream_key: "key-b", cursor: "cursor-b" },
    ];
    const { pg: mockPg, calls } = makeMockPg(rows);
    const store = new PostgresCursorStore(mockPg);

    const result = await store.getMany(["key-a", "key-b", "key-c"]);

    // Exactly one SQL query issued
    expect(calls).toHaveLength(1);

    // Keys present in rows are mapped to their cursor values
    expect(result["key-a"]).toBe("cursor-a");
    expect(result["key-b"]).toBe("cursor-b");

    // Key absent from rows is mapped to null
    expect(result["key-c"]).toBeNull();
  });

  it("getMany maps all absent keys to null when no rows are returned", async () => {
    const { pg: mockPg, calls } = makeMockPg([]); // no rows
    const store = new PostgresCursorStore(mockPg);

    const result = await store.getMany(["x", "y"]);

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ x: null, y: null });
  });

  it("getMany propagates a pg.query error", async () => {
    const error = new Error("db connection lost");
    const failingPg: PgLike = {
      query: async () => {
        throw error;
      },
    };
    const store = new PostgresCursorStore(failingPg);

    await expect(store.getMany(["key-a"])).rejects.toThrow("db connection lost");
  });

  // -------------------------------------------------------------------------
  // setMany
  // -------------------------------------------------------------------------

  it("setMany with empty object returns without issuing any query", async () => {
    const { pg: mockPg, calls } = makeMockPg();
    const store = new PostgresCursorStore(mockPg);

    await store.setMany({});

    expect(calls).toHaveLength(0);
  });

  it("setMany with N entries issues exactly one query", async () => {
    const { pg: mockPg, calls } = makeMockPg();
    const store = new PostgresCursorStore(mockPg);

    await store.setMany({ "key-a": "cursor-a", "key-b": "cursor-b", "key-c": "cursor-c" });

    expect(calls).toHaveLength(1);
  });

  it("setMany propagates a pg.query error", async () => {
    const error = new Error("upsert failed");
    const failingPg: PgLike = {
      query: async () => {
        throw error;
      },
    };
    const store = new PostgresCursorStore(failingPg);

    await expect(store.setMany({ "key-a": "cursor-a" })).rejects.toThrow("upsert failed");
  });
});
