import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresCursorStore } from "../../src/PostgresCursorStore.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("PostgresCursorStore batch integration tests", () => {
  const isIntegrationTest = process.env.INTEGRATION_TESTS === "true";

  if (!isIntegrationTest) {
    it("skipping PostgresCursorStore batch integration tests (INTEGRATION_TESTS is not true)", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const connectionString =
    process.env.PG_TEST_URL || "postgres://postgres:postgres@localhost:5432/postgres";

  let pool: any;
  let store: PostgresCursorStore;

  beforeAll(async () => {
    const pg = await import("pg");
    pool = new pg.default.Pool({ connectionString });
    store = new PostgresCursorStore(pool);

    const migrationPath = path.resolve(__dirname, "../../migrations/001_cursor_store.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    await pool.query(migrationSql);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM cursor_store WHERE stream_key LIKE $1", ["batch-test-%"]);
      await pool.end();
    }
  });

  // ---------------------------------------------------------------------------
  // getMany
  // ---------------------------------------------------------------------------

  it("getMany returns null for keys that have no stored cursor", async () => {
    const result = await store.getMany(["batch-test-missing-1", "batch-test-missing-2"]);
    expect(result["batch-test-missing-1"]).toBeNull();
    expect(result["batch-test-missing-2"]).toBeNull();
  });

  it("getMany returns written values and null for absent keys in the same call", async () => {
    await store.set("batch-test-get-1", "cursor-aaa");

    const result = await store.getMany(["batch-test-get-1", "batch-test-get-missing"]);

    expect(result["batch-test-get-1"]).toBe("cursor-aaa");
    expect(result["batch-test-get-missing"]).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // setMany
  // ---------------------------------------------------------------------------

  it("setMany writes multiple entries and getMany reads them back correctly", async () => {
    const entries = {
      "batch-test-set-1": "cursor-111",
      "batch-test-set-2": "cursor-222",
      "batch-test-set-3": "cursor-333",
    };

    await store.setMany(entries);

    const result = await store.getMany(Object.keys(entries));

    expect(result["batch-test-set-1"]).toBe("cursor-111");
    expect(result["batch-test-set-2"]).toBe("cursor-222");
    expect(result["batch-test-set-3"]).toBe("cursor-333");
  });

  it("setMany upserts — overwrites existing cursors without creating extra rows", async () => {
    await store.set("batch-test-upsert-1", "old-cursor");

    await store.setMany({
      "batch-test-upsert-1": "new-cursor",
      "batch-test-upsert-2": "fresh-cursor",
    });

    const result = await store.getMany(["batch-test-upsert-1", "batch-test-upsert-2"]);
    expect(result["batch-test-upsert-1"]).toBe("new-cursor");
    expect(result["batch-test-upsert-2"]).toBe("fresh-cursor");

    // Verify no duplicate rows were created
    const countRes = await pool.query("SELECT COUNT(*) FROM cursor_store WHERE stream_key = $1", [
      "batch-test-upsert-1",
    ]);
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });
});
