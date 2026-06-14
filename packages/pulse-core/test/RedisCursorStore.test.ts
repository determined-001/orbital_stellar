import { describe, it, expect } from "vitest";
import { RedisCursorStore } from "../src/RedisCursorStore.js";
import type { RedisLike } from "../src/RedisCursorStore.js";

// ---------------------------------------------------------------------------
// In-memory mock RedisLike — records calls and stores state
// ---------------------------------------------------------------------------

function makeMockRedis(): {
  redis: RedisLike;
  store: Map<string, string>;
  getCalls: string[];
  setCalls: Array<{ key: string; value: string }>;
  mgetCalls: string[][];
  msetCalls: string[][];
} {
  const store = new Map<string, string>();
  const getCalls: string[] = [];
  const setCalls: Array<{ key: string; value: string }> = [];
  const mgetCalls: string[][] = [];
  const msetCalls: string[][] = [];

  const redis: RedisLike = {
    async get(key: string) {
      getCalls.push(key);
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      setCalls.push({ key, value });
      store.set(key, value);
    },
    async mget(...keys: string[]) {
      mgetCalls.push(keys);
      return keys.map((k) => store.get(k) ?? null);
    },
    async mset(...args: string[]) {
      msetCalls.push(args);
      // args is [k1, v1, k2, v2, …]
      for (let i = 0; i < args.length; i += 2) {
        store.set(args[i]!, args[i + 1]!);
      }
    },
  };

  return { redis, store, getCalls, setCalls, mgetCalls, msetCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedisCursorStore", () => {
  describe("get", () => {
    it("delegates to redis.get and returns the stored value", async () => {
      const { redis, getCalls } = makeMockRedis();
      redis.set("stream-1", "cursor-abc");
      const store = new RedisCursorStore(redis);

      const result = await store.get("stream-1");

      expect(result).toBe("cursor-abc");
      expect(getCalls).toContain("stream-1");
    });

    it("returns null for a key that has no stored cursor", async () => {
      const { redis } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      const result = await store.get("missing-key");

      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("delegates to redis.set and persists the value", async () => {
      const { redis, setCalls } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      await store.set("stream-1", "cursor-xyz");

      expect(setCalls).toContainEqual({ key: "stream-1", value: "cursor-xyz" });
      expect(await store.get("stream-1")).toBe("cursor-xyz");
    });
  });

  describe("getMany", () => {
    it("returns {} for an empty keys array without calling mget", async () => {
      const { redis, mgetCalls } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      const result = await store.getMany([]);

      expect(result).toEqual({});
      expect(mgetCalls).toHaveLength(0);
    });

    it("calls mget exactly once with all keys", async () => {
      const { redis, mgetCalls } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      await store.getMany(["key-a", "key-b", "key-c"]);

      expect(mgetCalls).toHaveLength(1);
      expect(mgetCalls[0]).toEqual(["key-a", "key-b", "key-c"]);
    });

    it("maps positional results back to keys correctly", async () => {
      const { redis } = makeMockRedis();
      await redis.set("key-a", "cursor-1");
      await redis.set("key-b", "cursor-2");
      const store = new RedisCursorStore(redis);

      const result = await store.getMany(["key-a", "key-b"]);

      expect(result).toEqual({ "key-a": "cursor-1", "key-b": "cursor-2" });
    });

    it("maps null (missing key) to null in the result record", async () => {
      const { redis } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      const result = await store.getMany(["missing-key"]);

      expect(result).toEqual({ "missing-key": null });
    });

    it("handles a mix of present and missing keys", async () => {
      const { redis } = makeMockRedis();
      await redis.set("exists", "val");
      const store = new RedisCursorStore(redis);

      const result = await store.getMany(["exists", "missing"]);

      expect(result).toEqual({ exists: "val", missing: null });
    });

    it("propagates errors thrown by redis.mget", async () => {
      const error = new Error("mget failed");
      const failingRedis: RedisLike = {
        get: async () => null,
        set: async () => {},
        mget: async () => {
          throw error;
        },
        mset: async () => {},
      };
      const store = new RedisCursorStore(failingRedis);

      await expect(store.getMany(["key"])).rejects.toThrow("mget failed");
    });
  });

  describe("setMany", () => {
    it("returns without calling mset for an empty entries object", async () => {
      const { redis, msetCalls } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      await store.setMany({});

      expect(msetCalls).toHaveLength(0);
    });

    it("calls mset exactly once with the flat interleaved args array", async () => {
      const { redis, msetCalls } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      await store.setMany({ "key-a": "val-1", "key-b": "val-2" });

      expect(msetCalls).toHaveLength(1);
      // Flat interleaved: [k1, v1, k2, v2]
      expect(msetCalls[0]).toEqual(["key-a", "val-1", "key-b", "val-2"]);
    });

    it("persists values so they are retrievable via getMany", async () => {
      const { redis } = makeMockRedis();
      const store = new RedisCursorStore(redis);

      await store.setMany({ "stream-x": "cursor-x", "stream-y": "cursor-y" });
      const result = await store.getMany(["stream-x", "stream-y"]);

      expect(result).toEqual({ "stream-x": "cursor-x", "stream-y": "cursor-y" });
    });

    it("propagates errors thrown by redis.mset", async () => {
      const error = new Error("mset failed");
      const failingRedis: RedisLike = {
        get: async () => null,
        set: async () => {},
        mget: async () => [],
        mset: async () => {
          throw error;
        },
      };
      const store = new RedisCursorStore(failingRedis);

      await expect(store.setMany({ "key-a": "val-a" })).rejects.toThrow("mset failed");
    });
  });
});
