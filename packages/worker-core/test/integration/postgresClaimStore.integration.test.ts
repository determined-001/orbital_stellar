import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IdempotencyManager, PostgresClaimStore, fireKeyToString } from "../../src/index.js";

const enabled = process.env.INTEGRATION_TESTS === "true";

describe("PostgresClaimStore restart recovery", () => {
  if (!enabled) {
    it("skipping Postgres integration test (INTEGRATION_TESTS is not true)", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const connectionString =
    process.env.PG_TEST_URL || "postgres://postgres:postgres@localhost:5432/postgres";
  let pool: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    end: () => Promise<void>;
  };

  beforeAll(async () => {
    const pg = await import("pg");
    pool = new pg.default.Pool({ connectionString });
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../migrations/001_worker_fire_claims.sql",
    );
    await pool.query(fs.readFileSync(migrationPath, "utf8"));
  });

  afterAll(async () => {
    await pool.query("DELETE FROM worker_fire_claims WHERE fire_key LIKE $1", ["restart-test:%"]);
    await pool.end();
  });

  it("survives a process restart and checks chain before retrying", async () => {
    const key = { workerId: "restart-test", windowStartLedger: 99 };
    let chainExecuted = false;
    const firstStore = new PostgresClaimStore(pool);
    const firstWorker = new IdempotencyManager(firstStore, async () => chainExecuted, 10);

    await expect(
      firstWorker.claimThenSubmit(key, "process-a", async () => {
        throw new Error("simulated crash before confirmation");
      }),
    ).rejects.toThrow("simulated crash before confirmation");

    const restartedStore = new PostgresClaimStore(pool);
    const restartedWorker = new IdempotencyManager(restartedStore, async () => chainExecuted, 10);
    expect(await restartedWorker.claimThenSubmit(key, "process-b", async () => undefined)).toBe(
      false,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    chainExecuted = true;
    expect(
      await restartedWorker.claimThenSubmit(key, "process-b", async () => {
        throw new Error("must not resubmit");
      }),
    ).toBe(false);

    expect(await restartedStore.get(fireKeyToString(key))).toBeNull();
  });
});
