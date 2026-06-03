import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresCursorStore } from "../src/PostgresCursorStore.js";
import pg from "pg";
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

  const connectionString = process.env.PG_TEST_URL || "postgres://postgres:postgres@localhost:5432/postgres";
  let pool: pg.Pool;
  let store: PostgresCursorStore;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
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
    const res = await pool.query("SELECT COUNT(*) FROM cursor_store WHERE stream_key = $1", [streamKey]);
    expect(parseInt(res.rows[0].count, 10)).toBe(1);
  });
});
