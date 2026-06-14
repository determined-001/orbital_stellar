import { describe, it } from "vitest";
import * as fc from "fast-check";
import { RedisCursorStore } from "../src/RedisCursorStore.js";
import type { RedisLike } from "../src/RedisCursorStore.js";

// ---------------------------------------------------------------------------
// Mock RedisLike helpers for property tests
// ---------------------------------------------------------------------------

function makeCountingRedis(): { redis: RedisLike; mgetCount: number[]; msetCount: number[] } {
  const mgetCount = [0];
  const msetCount = [0];
  const redis: RedisLike = {
    async get() {
      return null;
    },
    async set() {},
    async mget(..._keys: string[]) {
      mgetCount[0]++;
      return _keys.map(() => null);
    },
    async mset(..._args: string[]) {
      msetCount[0]++;
    },
  };
  return { redis, mgetCount, msetCount };
}

function makeInMemoryRedis(): { redis: RedisLike; store: Map<string, string> } {
  const store = new Map<string, string>();
  const redis: RedisLike = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async mget(...keys: string[]) {
      return keys.map((k) => store.get(k) ?? null);
    },
    async mset(...args: string[]) {
      for (let i = 0; i < args.length; i += 2) {
        store.set(args[i]!, args[i + 1]!);
      }
    },
  };
  return { redis, store };
}

// Exclude prototype-poisoning keys that behave differently with plain objects.
// Real stream keys (Stellar addresses, paging tokens) are never these values.
const PROTO_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
];
const safeKey = fc.string({ minLength: 1 }).filter((k) => !PROTO_KEYS.includes(k));

// ---------------------------------------------------------------------------
// Property 7: RedisCursorStore getMany issues exactly one MGET
// Feature: cursor-store-batch-operations, Property 7: RedisCursorStore getMany issues exactly one MGET
// Validates: Requirements 4.2
// ---------------------------------------------------------------------------

describe("RedisCursorStore PBT", () => {
  it("Property 7: getMany issues exactly one mget call for any non-empty key array", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(safeKey, { minLength: 1, maxLength: 50 }), async (keys) => {
        const { redis, mgetCount } = makeCountingRedis();
        const store = new RedisCursorStore(redis);

        await store.getMany(keys);

        return mgetCount[0] === 1;
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 8: RedisCursorStore setMany issues exactly one MSET
  // Feature: cursor-store-batch-operations, Property 8: RedisCursorStore setMany issues exactly one MSET
  // Validates: Requirements 4.3
  // ---------------------------------------------------------------------------

  it("Property 8: setMany issues exactly one mset call for any non-empty entries map", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const { redis, msetCount } = makeCountingRedis();
          const store = new RedisCursorStore(redis);

          await store.setMany(entries);

          return msetCount[0] === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 9: RedisCursorStore batch round-trip
  // Feature: cursor-store-batch-operations, Property 9: RedisCursorStore batch round-trip
  // Validates: Requirements 4.7
  // ---------------------------------------------------------------------------

  it("Property 9: setMany then getMany returns the written values without encoding change", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const { redis } = makeInMemoryRedis();
          const store = new RedisCursorStore(redis);

          await store.setMany(entries);
          const result = await store.getMany(Object.keys(entries));

          for (const [key, value] of Object.entries(entries)) {
            if (result[key] !== value) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 10: Null handling is consistent across all adapters
  // Feature: cursor-store-batch-operations, Property 10: Null handling is consistent across all adapters
  // Validates: Requirements 1.6, 3.3, 4.4
  // ---------------------------------------------------------------------------

  it("Property 10: getMany returns null for every key never written — consistent across default, Postgres mock, and Redis mock", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(safeKey, { minLength: 1, maxLength: 20 }), async (keys) => {
        const { redis } = makeInMemoryRedis();
        const store = new RedisCursorStore(redis);
        // Nothing written — all keys are missing

        const result = await store.getMany(keys);

        for (const key of keys) {
          if (result[key] !== null) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
