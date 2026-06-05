import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

import { FakeSorobanRpc } from "../fakes/FakeSorobanRpc.js";
import { SorobanSubscriber } from "../../src/SorobanSubscriber.js";

// Postgres adapter
let pgPool: any = null;
let PostgresCursorStore: any = null;

const isIntegration = process.env.INTEGRATION_TESTS === "true";

if (isIntegration) {
  try {
    // lazy-load pg and PostgresCursorStore if integration tests are enabled
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require("pg");
    pgPool = pg.Pool;
    PostgresCursorStore = require("../../src/PostgresCursorStore.js").PostgresCursorStore;
  } catch (e) {
    // leave as null; tests will skip Postgres
    pgPool = null;
    PostgresCursorStore = null;
  }
}

function createMemoryStore() {
  let cursor: string | undefined = undefined;
  return {
    async getCursor() { return cursor; },
    async saveCursor(c: string) { cursor = c; },
    async cleanup?() { /* noop */ },
  } as any;
}

async function createFileStore(tmpDir: string) {
  const file = path.join(tmpDir, "cursor.txt");
  return {
    async getCursor() {
      try {
        const data = await fs.readFile(file, "utf8");
        return data;
      } catch (e) {
        return undefined;
      }
    },
    async saveCursor(c: string) { await fs.writeFile(file, c, "utf8"); },
    async cleanup() { try { await fs.unlink(file); } catch {} },
  } as any;
}

async function createPostgresStore(): Promise<any> {
  if (!PostgresCursorStore) throw new Error("Postgres adapter unavailable");
  const connectionString = process.env.PG_TEST_URL || "postgres://postgres:postgres@localhost:5432/postgres";
  const Pool = pgPool;
  const pool = new Pool({ connectionString });
  const store = new PostgresCursorStore(pool);

  // run migration if available
  const migrationPath = path.resolve(__dirname, "../../migrations/001_cursor_store.sql");
  try {
    const sql = await fs.readFile(migrationPath, "utf8");
    await pool.query(sql);
  } catch (e) {
    // ignore
  }

  return {
    async getCursor() { const v = await store.get("test-stream"); return v ?? undefined; },
    async saveCursor(c: string) { await store.set("test-stream", c); },
    async cleanup() { try { await pool.query("DELETE FROM cursor_store WHERE stream_key = $1", ["test-stream"]); } catch {} await pool.end(); },
  };
}

describe("Integration: cursor resume across stores", () => {
  const stores = [] as { name: string; factory: () => Promise<any> | any; integrationOnly?: boolean }[];
  stores.push({ name: "memory", factory: createMemoryStore });
  stores.push({ name: "file", factory: async () => createFileStore(await fs.mkdtemp(path.join(os.tmpdir(), "cursor-"))) });
  stores.push({ name: "postgres", factory: createPostgresStore, integrationOnly: true });
  // Redis and S3 adapters not present in this repository; placeholders omitted.

  for (const storeDesc of stores) {
    const testFn = storeDesc.integrationOnly && !isIntegration ? it.skip : it;

    testFn(`store=${storeDesc.name} should resume cursor across restart (kill-restart invariant)`, async () => {
      const factoryResult = await (typeof storeDesc.factory === "function" ? storeDesc.factory() : storeDesc.factory);
      const store = factoryResult as any;

      const fakeRpc = new FakeSorobanRpc();
      const processed: any[] = [];

      const subscriber = new SorobanSubscriber({
        rpc: fakeRpc as any,
        cursorStore: store,
        onEvent: async (evt: any) => { processed.push(evt); },
        pageSize: 100,
      });

      await subscriber.pollOnce();
      expect(processed.length).toBe(100);

      // Simulate abrupt kill by creating a fresh subscriber using same store
      const restarted = new SorobanSubscriber({
        rpc: fakeRpc as any,
        cursorStore: store,
        onEvent: async (evt: any) => { processed.push(evt); },
        pageSize: 100,
      });

      await restarted.pollOnce();
      expect(processed.length).toBe(200);

      // Verify tokens are sequential and no dup/skip
      for (let i = 0; i < 200; i++) {
        const expectedToken = (i + 1).toString().padStart(6, "0");
        expect(processed[i].pagingToken).toBe(expectedToken);
      }

      if (store.cleanup) await store.cleanup();
    });
  }
});