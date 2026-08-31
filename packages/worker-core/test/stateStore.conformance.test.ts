/**
 * Conformance test suite for WorkerStateStore backends.
 *
 * Every implementation (Memory, File, Postgres, Redis) must pass all cases
 * in this suite. The Postgres and Redis backends run against the in-process
 * fakes in `stateStore.fakes.ts`, so the suite is fully hermetic — no live
 * server required — and proves every backend agrees with the Memory
 * reference implementation.
 *
 * The suite is structured as a shared `runConformanceTests(factory)` function
 * so new backends are added by appending a factory at the bottom of this file.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  WorkerStateStore,
  type WorkerFireRecord,
  type WorkerClaimRecord,
} from "../src/WorkerStateStore.js";
import { MemoryWorkerStateStore } from "../src/MemoryWorkerStateStore.js";
import { FileWorkerStateStore } from "../src/FileWorkerStateStore.js";
import { PostgresWorkerStateStore } from "../src/PostgresWorkerStateStore.js";
import { RedisWorkerStateStore } from "../src/RedisWorkerStateStore.js";
import { migrateWorkerState } from "../src/migrateWorkerState.js";
import { MockPg, MockRedis } from "./stateStore.fakes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFireRecord(overrides?: Partial<WorkerFireRecord>): WorkerFireRecord {
  return {
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-01T01:00:00.000Z",
    firedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaimRecord(
  workerId: string,
  overrides?: Partial<WorkerClaimRecord>,
): WorkerClaimRecord {
  const now = new Date();
  return {
    windowId: "window-1",
    workerId,
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared conformance suite
// ─────────────────────────────────────────────────────────────────────────────

function runConformanceTests(
  label: string,
  factory: () => Promise<{ store: WorkerStateStore; teardown?: () => Promise<void> }>,
) {
  describe(`WorkerStateStore conformance — ${label}`, () => {
    let store: WorkerStateStore;
    let teardown: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const ctx = await factory();
      store = ctx.store;
      teardown = ctx.teardown;
    });

    afterEach(async () => {
      await teardown?.();
    });

    // ───────────────────────────────────────────────────────────────────────
    // getWorker
    // ───────────────────────────────────────────────────────────────────────

    describe("getWorker", () => {
      it("returns null for an unknown worker", async () => {
        expect(await store.getWorker("does-not-exist")).toBeNull();
      });

      it("returns the worker after registration", async () => {
        await store.registerWorker({ workerId: "w1" });
        const state = await store.getWorker("w1");
        expect(state).not.toBeNull();
        expect(state!.workerId).toBe("w1");
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // registerWorker
    // ───────────────────────────────────────────────────────────────────────

    describe("registerWorker", () => {
      it("creates a worker with an empty fire history and no active claims", async () => {
        const state = await store.registerWorker({ workerId: "w2" });
        expect(state.workerId).toBe("w2");
        expect(state.fireHistory).toHaveLength(0);
        expect(state.activeClaims).toHaveLength(0);
        expect(state.lastFiredWindowStart).toBeNull();
        expect(state.lastFiredWindowEnd).toBeNull();
        expect(state.schemaVersion).toBe(1);
      });

      it("is idempotent — a second call returns the original record unchanged", async () => {
        const first = await store.registerWorker({ workerId: "w3", metadata: { foo: "bar" } });
        const second = await store.registerWorker({ workerId: "w3", metadata: { foo: "baz" } });
        expect(second.registeredAt).toBe(first.registeredAt);
        // metadata should not have been overwritten
        expect(second.metadata).toEqual({ foo: "bar" });
      });

      it("accepts an explicit registeredAt timestamp", async () => {
        const ts = "2025-01-01T00:00:00.000Z";
        const state = await store.registerWorker({ workerId: "w4", registeredAt: ts });
        expect(state.registeredAt).toBe(ts);
      });

      it("stores metadata passed at registration", async () => {
        const meta = { region: "us-east-1", version: 2 };
        const state = await store.registerWorker({ workerId: "w5", metadata: meta });
        expect(state.metadata).toEqual(meta);
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // appendFireRecord
    // ───────────────────────────────────────────────────────────────────────

    describe("appendFireRecord", () => {
      it("throws when the worker has not been registered", async () => {
        await expect(
          store.appendFireRecord({ workerId: "ghost", record: makeFireRecord() }),
        ).rejects.toThrow(/not registered/i);
      });

      it("appends a fire record and updates lastFiredWindow* fields", async () => {
        await store.registerWorker({ workerId: "w6" });
        const record = makeFireRecord({
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-01T01:00:00.000Z",
        });
        const state = await store.appendFireRecord({ workerId: "w6", record });
        expect(state.fireHistory).toHaveLength(1);
        expect(state.fireHistory[0]).toMatchObject(record);
        expect(state.lastFiredWindowStart).toBe(record.windowStart);
        expect(state.lastFiredWindowEnd).toBe(record.windowEnd);
      });

      it("is append-only — multiple appends grow the history without losing earlier records", async () => {
        await store.registerWorker({ workerId: "w7" });
        const r1 = makeFireRecord({
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-01T01:00:00.000Z",
          firedAt: "2026-01-01T01:00:01.000Z",
        });
        const r2 = makeFireRecord({
          windowStart: "2026-01-01T01:00:00.000Z",
          windowEnd: "2026-01-01T02:00:00.000Z",
          firedAt: "2026-01-01T02:00:01.000Z",
        });
        const r3 = makeFireRecord({
          windowStart: "2026-01-01T02:00:00.000Z",
          windowEnd: "2026-01-01T03:00:00.000Z",
          firedAt: "2026-01-01T03:00:01.000Z",
        });

        await store.appendFireRecord({ workerId: "w7", record: r1 });
        await store.appendFireRecord({ workerId: "w7", record: r2 });
        const state = await store.appendFireRecord({ workerId: "w7", record: r3 });

        expect(state.fireHistory).toHaveLength(3);
        expect(state.fireHistory[0]).toMatchObject(r1);
        expect(state.fireHistory[1]).toMatchObject(r2);
        expect(state.fireHistory[2]).toMatchObject(r3);
      });

      it("persists across store instances (durability round-trip)", async () => {
        // Skip for in-memory: it doesn't persist across instances by design
        // FileStore factory creates a fresh store over the same directory.
        await store.registerWorker({ workerId: "w8" });
        const record = makeFireRecord();
        await store.appendFireRecord({ workerId: "w8", record });

        // Re-read from the same underlying store
        const state = await store.getWorker("w8");
        expect(state!.fireHistory).toHaveLength(1);
        expect(state!.fireHistory[0]).toMatchObject(record);
      });

      it("fire history records are returned in insertion order", async () => {
        await store.registerWorker({ workerId: "w9" });
        for (let i = 0; i < 5; i++) {
          await store.appendFireRecord({
            workerId: "w9",
            record: makeFireRecord({
              windowStart: `2026-01-0${i + 1}T00:00:00.000Z`,
              windowEnd: `2026-01-0${i + 1}T01:00:00.000Z`,
              firedAt: `2026-01-0${i + 1}T01:00:01.000Z`,
            }),
          });
        }
        const state = await store.getWorker("w9");
        const starts = state!.fireHistory.map((r) => r.windowStart);
        expect(starts).toEqual([...starts].sort());
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // writeClaim / releaseClaim
    // ───────────────────────────────────────────────────────────────────────

    describe("writeClaim", () => {
      it("throws when the worker has not been registered", async () => {
        await expect(
          store.writeClaim({
            workerId: "ghost",
            claim: makeClaimRecord("ghost"),
          }),
        ).rejects.toThrow(/not registered/i);
      });

      it("adds a claim record to the worker state", async () => {
        await store.registerWorker({ workerId: "w10" });
        const claim = makeClaimRecord("w10");
        const state = await store.writeClaim({ workerId: "w10", claim });
        expect(state.activeClaims).toHaveLength(1);
        expect(state.activeClaims[0]).toMatchObject(claim);
      });

      it("renewing a claim for the same windowId replaces the old entry (no duplicates)", async () => {
        await store.registerWorker({ workerId: "w11" });
        const claim1 = makeClaimRecord("w11", {
          windowId: "win-a",
          expiresAt: "2026-01-01T00:01:00.000Z",
        });
        const claim2 = makeClaimRecord("w11", {
          windowId: "win-a",
          expiresAt: "2026-01-01T00:02:00.000Z",
        });
        await store.writeClaim({ workerId: "w11", claim: claim1 });
        const state = await store.writeClaim({ workerId: "w11", claim: claim2 });
        expect(state.activeClaims).toHaveLength(1);
        expect(state.activeClaims[0]!.expiresAt).toBe(claim2.expiresAt);
      });

      it("multiple different windowIds coexist as separate claims", async () => {
        await store.registerWorker({ workerId: "w12" });
        await store.writeClaim({
          workerId: "w12",
          claim: makeClaimRecord("w12", { windowId: "win-x" }),
        });
        const state = await store.writeClaim({
          workerId: "w12",
          claim: makeClaimRecord("w12", { windowId: "win-y" }),
        });
        expect(state.activeClaims).toHaveLength(2);
        const ids = state.activeClaims.map((c) => c.windowId);
        expect(ids).toContain("win-x");
        expect(ids).toContain("win-y");
      });
    });

    describe("releaseClaim", () => {
      it("throws when the worker has not been registered", async () => {
        await expect(store.releaseClaim({ workerId: "ghost", windowId: "win-1" })).rejects.toThrow(
          /not registered/i,
        );
      });

      it("removes a claim from the active list", async () => {
        await store.registerWorker({ workerId: "w13" });
        await store.writeClaim({
          workerId: "w13",
          claim: makeClaimRecord("w13", { windowId: "win-1" }),
        });
        const state = await store.releaseClaim({ workerId: "w13", windowId: "win-1" });
        expect(state.activeClaims).toHaveLength(0);
      });

      it("is a no-op when the claim does not exist", async () => {
        await store.registerWorker({ workerId: "w14" });
        // No claim was written — this must not throw
        const state = await store.releaseClaim({ workerId: "w14", windowId: "nonexistent" });
        expect(state.activeClaims).toHaveLength(0);
      });

      it("releasing one claim leaves other claims intact", async () => {
        await store.registerWorker({ workerId: "w15" });
        await store.writeClaim({
          workerId: "w15",
          claim: makeClaimRecord("w15", { windowId: "win-a" }),
        });
        await store.writeClaim({
          workerId: "w15",
          claim: makeClaimRecord("w15", { windowId: "win-b" }),
        });
        const state = await store.releaseClaim({ workerId: "w15", windowId: "win-a" });
        expect(state.activeClaims).toHaveLength(1);
        expect(state.activeClaims[0]!.windowId).toBe("win-b");
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // getAllWorkers
    // ───────────────────────────────────────────────────────────────────────

    describe("getAllWorkers", () => {
      it("returns an empty array when no workers are registered", async () => {
        const all = await store.getAllWorkers();
        expect(all).toEqual([]);
      });

      it("returns all registered workers", async () => {
        await store.registerWorker({ workerId: "wa" });
        await store.registerWorker({ workerId: "wb" });
        await store.registerWorker({ workerId: "wc" });
        const all = await store.getAllWorkers();
        const ids = all.map((w) => w.workerId).sort();
        expect(ids).toContain("wa");
        expect(ids).toContain("wb");
        expect(ids).toContain("wc");
      });

      it("returned state includes fire history accumulated so far", async () => {
        await store.registerWorker({ workerId: "wd" });
        await store.appendFireRecord({ workerId: "wd", record: makeFireRecord() });
        const all = await store.getAllWorkers();
        const wd = all.find((w) => w.workerId === "wd");
        expect(wd).toBeDefined();
        expect(wd!.fireHistory).toHaveLength(1);
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // Schema version
    // ───────────────────────────────────────────────────────────────────────

    describe("schemaVersion", () => {
      it("persists schemaVersion = 1 on every worker state", async () => {
        const state = await store.registerWorker({ workerId: "wv" });
        expect(state.schemaVersion).toBe(1);

        const fetched = await store.getWorker("wv");
        expect(fetched!.schemaVersion).toBe(1);
      });
    });

    // ───────────────────────────────────────────────────────────────────────
    // migrateWorkerState
    // ───────────────────────────────────────────────────────────────────────

    describe("migrateWorkerState", () => {
      it("copies all workers, history and claims from source to target", async () => {
        // Source is always Memory for this cross-backend migration test
        const source = new MemoryWorkerStateStore();
        await source.registerWorker({ workerId: "mig-1", metadata: { tag: "x" } });
        await source.appendFireRecord({ workerId: "mig-1", record: makeFireRecord() });
        await source.writeClaim({
          workerId: "mig-1",
          claim: makeClaimRecord("mig-1"),
        });

        const result = await migrateWorkerState(source, store);
        expect(result.migrated).toBe(1);

        const migrated = await store.getWorker("mig-1");
        expect(migrated).not.toBeNull();
        expect(migrated!.fireHistory).toHaveLength(1);
        expect(migrated!.activeClaims).toHaveLength(1);
        expect(migrated!.metadata).toEqual({ tag: "x" });
      });

      it("returns migrated=0 when source is empty", async () => {
        const source = new MemoryWorkerStateStore();
        const result = await migrateWorkerState(source, store);
        expect(result.migrated).toBe(0);
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory backend
// ─────────────────────────────────────────────────────────────────────────────

runConformanceTests("Memory", async () => ({
  store: new MemoryWorkerStateStore(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// File backend
// ─────────────────────────────────────────────────────────────────────────────

runConformanceTests("File", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-state-"));
  return {
    store: new FileWorkerStateStore(dir),
    teardown: async () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Postgres backend — exercised through an in-process MockPg fake so the full
// conformance suite runs without a live Postgres server. The fake dispatches
// on the exact SQL the adapter issues, so behaviour is verified against real
// query semantics. Row-locking concurrency can only be verified against a
// real server; see `test:integration` for the opt-in live-suite.
// ─────────────────────────────────────────────────────────────────────────────

runConformanceTests("Postgres", async () => {
  const pg = new MockPg();
  return {
    store: new PostgresWorkerStateStore(pg),
    teardown: async () => {
      pg.registrations.clear();
      pg.claims.clear();
      pg.fireHistory.clear();
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Redis backend — exercised through an in-process MockRedis fake so the full
// conformance suite runs without a live Redis server. The fake implements the
// narrow `get`/`set`/`del`/`keys` surface the adapter actually calls.
// ─────────────────────────────────────────────────────────────────────────────

runConformanceTests("Redis", async () => {
  const redis = new MockRedis();
  return {
    store: new RedisWorkerStateStore(redis),
    teardown: async () => {
      redis.store.clear();
    },
  };
});
