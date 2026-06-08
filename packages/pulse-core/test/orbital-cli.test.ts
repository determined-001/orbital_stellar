import { exec } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { PostgresCursorStore, PgLike } from "../src/PostgresCursorStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cliPath = join(__dirname, "../bin/orbital");

const DATABASE_URL = process.env.PG_TEST_URL || "postgresql://user:password@localhost:5432/testdb";

const pg = new Pool({ connectionString: DATABASE_URL });

// Skip all tests in this suite if not running integration tests
const isIntegrationTest = process.env.INTEGRATION_TESTS === "true";

if (!isIntegrationTest) {
  test("skipping orbital CLI tests (INTEGRATION_TESTS is not true)", () => {
    expect(true).toBe(true);
  });
} else {
  beforeAll(async () => {
    // Ensure the database is clean before tests
    await pg.query("DROP TABLE IF EXISTS cursor_store");
    await pg.query(
      `CREATE TABLE cursor_store (
        stream_key VARCHAR(255) PRIMARY KEY,
        cursor VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );`
    );
  });

  afterAll(async () => {
    await pg.query("DROP TABLE IF EXISTS cursor_store");
    await pg.end();
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE TABLE cursor_store");
  });

  async function execCli(command: string, stdinData?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = exec(`node ${cliPath} ${command}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`stderr: ${stderr}`);
          return reject(error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }
        resolve(stdout);
      });

      if (stdinData) {
        child.stdin?.write(stdinData);
        child.stdin?.end();
      }
    });
  }

  test("cursor dump outputs line-delimited JSON", async () => {
    await pg.query("INSERT INTO cursor_store (stream_key, cursor) VALUES ($1, $2)", ["key1", "cursorA"]);
    await pg.query("INSERT INTO cursor_store (stream_key, cursor) VALUES ($1, $2)", ["key2", "cursorB"]);

    const output = await execCli("cursor dump");
    const lines = output.trim().split("\n").map(JSON.parse);

    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual({ stream_key: "key1", cursor: "cursorA" });
    expect(lines).toContainEqual({ stream_key: "key2", cursor: "cursorB" });
  });

  test("cursor restore reads line-delimited JSON from stdin", async () => {
    const input = [
      JSON.stringify({ stream_key: "key3", cursor: "cursorC" }),
      JSON.stringify({ stream_key: "key4", cursor: "cursorD" }),
    ].join("\n");

    await execCli("cursor restore", input);

    const { rows } = await pg.query("SELECT stream_key, cursor FROM cursor_store ORDER BY stream_key");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ stream_key: "key3", cursor: "cursorC" });
    expect(rows[1]).toEqual({ stream_key: "key4", cursor: "cursorD" });
  });

  test("cursor restore updates existing cursors", async () => {
    await pg.query("INSERT INTO cursor_store (stream_key, cursor) VALUES ($1, $2)", ["key5", "cursorE_old"]);

    const input = JSON.stringify({ stream_key: "key5", cursor: "cursorE_new" });
    await execCli("cursor restore", input);

    const { rows } = await pg.query("SELECT cursor FROM cursor_store WHERE stream_key = $1", ["key5"]);
    expect(rows[0].cursor).toBe("cursorE_new");
  });

  test("cursor dump and restore round-trip", async () => {
    await pg.query("INSERT INTO cursor_store (stream_key, cursor) VALUES ($1, $2)", ["key_round_1", "cursor_r1"]);
    await pg.query("INSERT INTO cursor_store (stream_key, cursor) VALUES ($1, $2)", ["key_round_2", "cursor_r2"]);

    const dumped = await execCli("cursor dump");

    await pg.query("TRUNCATE TABLE cursor_store");

    await execCli("cursor restore", dumped);

    const { rows } = await pg.query("SELECT stream_key, cursor FROM cursor_store ORDER BY stream_key");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ stream_key: "key_round_1", cursor: "cursor_r1" });
    expect(rows[1]).toEqual({ stream_key: "key_round_2", cursor: "cursor_r2" });
  });

  test("cursor restore handles malformed JSON", async () => {
    const input = `{"stream_key": "key_bad", "cursor": "cursor_bad"}\nnot-json`;

    await expect(execCli("cursor restore", input)).rejects.toThrow();

    const { rows } = await pg.query("SELECT COUNT(*) FROM cursor_store WHERE stream_key = $1", ["key_bad"]);
    expect(rows[0].count).toBe("0");
  });
}