import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheCursorStore } from "../src/cacheCursorStore.js";
import type { CursorStore } from "../src/CursorStore.js";

function makeInner(initial: string | null = "cursor-1"): CursorStore & { getCalls: number } {
  let stored = initial;
  return {
    getCalls: 0,
    async get() { this.getCalls++; return stored; },
    async set(_, cursor) { stored = cursor; },
  };
}

describe("cacheCursorStore", () => {
  it("calls inner.get only once within the TTL window", async () => {
    const inner = makeInner("abc");
    const store = cacheCursorStore(inner, { ttlMs: 1_000 });

    const r1 = await store.get("key");
    const r2 = await store.get("key");

    expect(r1).toBe("abc");
    expect(r2).toBe("abc");
    expect(inner.getCalls).toBe(1);
  });

  it("calls inner.get again after TTL expires", async () => {
    vi.useFakeTimers();
    const inner = makeInner("abc");
    const store = cacheCursorStore(inner, { ttlMs: 100 });

    await store.get("key");
    vi.advanceTimersByTime(101);
    await store.get("key");

    expect(inner.getCalls).toBe(2);
    vi.useRealTimers();
  });

  it("calls inner.get again after a set invalidates the cache", async () => {
    const inner = makeInner("abc");
    const store = cacheCursorStore(inner, { ttlMs: 1_000 });

    await store.get("key");
    await store.set("key", "xyz");
    const result = await store.get("key");

    expect(inner.getCalls).toBe(2);
    expect(result).toBe("xyz");
  });
});
