import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { coalesceCursorStore, CoalescingStore } from "../src/coalesceCursorStore.js";
import { CursorStore } from "../src/CursorStore.js";

// ---------------------------------------------------------------------------
// FakeInnerStore — records all calls, stores state in memory
// ---------------------------------------------------------------------------

class FakeInnerStore extends CursorStore {
  readonly store = new Map<string, string>();
  readonly getCalls: string[] = [];
  readonly getManyCalls: string[][] = [];
  readonly setManyCalls: Array<Record<string, string>> = [];

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  override async getMany(keys: string[]): Promise<Record<string, string | null>> {
    this.getManyCalls.push([...keys]);
    const result: Record<string, string | null> = {};
    for (const k of keys) result[k] = this.store.get(k) ?? null;
    return result;
  }

  override async setMany(entries: Record<string, string>): Promise<void> {
    this.setManyCalls.push({ ...entries });
    for (const [k, v] of Object.entries(entries)) this.store.set(k, v);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coalesceCursorStore factory validation", () => {
  it("throws RangeError for intervalMs = 0", () => {
    expect(() => coalesceCursorStore(new FakeInnerStore(), { intervalMs: 0 })).toThrow(RangeError);
  });

  it("throws RangeError for intervalMs = -1", () => {
    expect(() => coalesceCursorStore(new FakeInnerStore(), { intervalMs: -1 })).toThrow(RangeError);
  });

  it("throws RangeError for intervalMs = NaN", () => {
    expect(() => coalesceCursorStore(new FakeInnerStore(), { intervalMs: NaN })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError for intervalMs = Infinity", () => {
    expect(() => coalesceCursorStore(new FakeInnerStore(), { intervalMs: Infinity })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError for intervalMs = -Infinity", () => {
    expect(() => coalesceCursorStore(new FakeInnerStore(), { intervalMs: -Infinity })).toThrow(
      RangeError,
    );
  });

  it("does not throw for a valid positive intervalMs", () => {
    const store = coalesceCursorStore(new FakeInnerStore(), { intervalMs: 1000 });
    expect(store).toBeInstanceOf(CoalescingStore);
    store.dispose();
  });
});

describe("CoalescingStore buffered writes", () => {
  let inner: FakeInnerStore;
  let store: CoalescingStore;

  beforeEach(() => {
    inner = new FakeInnerStore();
    store = coalesceCursorStore(inner, { intervalMs: 10_000 });
  });

  afterEach(() => {
    store.dispose();
  });

  it("set returns immediately without calling InnerStore", async () => {
    await store.set("key-a", "cursor-1");
    expect(inner.setManyCalls).toHaveLength(0);
    expect(inner.getCalls).toHaveLength(0);
  });

  it("multiple set calls for the same key retain only the last value", async () => {
    await store.set("key-a", "cursor-1");
    await store.set("key-a", "cursor-2");
    await store.set("key-a", "cursor-3");

    const value = await store.get("key-a");
    expect(value).toBe("cursor-3");
    expect(inner.getCalls).toHaveLength(0); // served from buffer
  });

  it("setMany merges entries into buffer without calling InnerStore", async () => {
    await store.setMany({ "key-a": "cursor-a", "key-b": "cursor-b" });
    expect(inner.setManyCalls).toHaveLength(0);
  });

  it("setMany overwrites previously buffered values for the same key", async () => {
    await store.set("key-a", "old");
    await store.setMany({ "key-a": "new" });
    expect(await store.get("key-a")).toBe("new");
  });
});

describe("CoalescingStore reads", () => {
  let inner: FakeInnerStore;
  let store: CoalescingStore;

  beforeEach(() => {
    inner = new FakeInnerStore();
    store = coalesceCursorStore(inner, { intervalMs: 10_000 });
  });

  afterEach(() => {
    store.dispose();
  });

  it("get returns buffered value without calling InnerStore.get", async () => {
    await store.set("key-a", "cursor-1");
    const result = await store.get("key-a");
    expect(result).toBe("cursor-1");
    expect(inner.getCalls).toHaveLength(0);
  });

  it("get delegates to InnerStore for keys absent from buffer", async () => {
    inner.store.set("key-b", "inner-cursor");
    const result = await store.get("key-b");
    expect(result).toBe("inner-cursor");
    expect(inner.getCalls).toContain("key-b");
  });

  it("get returns null for keys absent from both buffer and InnerStore", async () => {
    const result = await store.get("missing");
    expect(result).toBeNull();
  });

  it("getMany returns buffered values and delegates only missing keys to InnerStore", async () => {
    await store.set("buffered", "buf-cursor");
    inner.store.set("inner-key", "inner-cursor");

    const result = await store.getMany(["buffered", "inner-key", "missing"]);

    expect(result["buffered"]).toBe("buf-cursor");
    expect(result["inner-key"]).toBe("inner-cursor");
    expect(result["missing"]).toBeNull();

    // Only non-buffered keys delegated to InnerStore
    expect(inner.getManyCalls).toHaveLength(1);
    expect(inner.getManyCalls[0]).toEqual(expect.arrayContaining(["inner-key", "missing"]));
    expect(inner.getManyCalls[0]).not.toContain("buffered");
  });

  it("getMany with all keys buffered does not call InnerStore.getMany", async () => {
    await store.set("k1", "v1");
    await store.set("k2", "v2");

    await store.getMany(["k1", "k2"]);

    expect(inner.getManyCalls).toHaveLength(0);
  });

  it("getMany with empty array returns {}", async () => {
    const result = await store.getMany([]);
    expect(result).toEqual({});
  });
});

describe("CoalescingStore flush", () => {
  let inner: FakeInnerStore;
  let store: CoalescingStore;

  beforeEach(() => {
    inner = new FakeInnerStore();
    store = coalesceCursorStore(inner, { intervalMs: 10_000 });
  });

  afterEach(() => {
    store.dispose();
  });

  it("flush on empty buffer does not call InnerStore.setMany", async () => {
    await store.flush();
    expect(inner.setManyCalls).toHaveLength(0);
  });

  it("flush drains buffer — calls InnerStore.setMany exactly once with all entries", async () => {
    await store.set("key-a", "cursor-a");
    await store.set("key-b", "cursor-b");

    await store.flush();

    expect(inner.setManyCalls).toHaveLength(1);
    expect(inner.setManyCalls[0]).toEqual({ "key-a": "cursor-a", "key-b": "cursor-b" });
  });

  it("buffer is empty after flush resolves", async () => {
    await store.set("key-a", "cursor-a");
    await store.flush();

    // A second flush should not call setMany again
    await store.flush();
    expect(inner.setManyCalls).toHaveLength(1);
  });

  it("flush writes the last-written value for each key", async () => {
    await store.set("key-a", "first");
    await store.set("key-a", "second");
    await store.set("key-a", "third");

    await store.flush();

    expect(inner.setManyCalls[0]!["key-a"]).toBe("third");
  });
});

describe("CoalescingStore timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("timer fires after intervalMs and calls InnerStore.setMany with buffered entries", async () => {
    const inner = new FakeInnerStore();
    const store = coalesceCursorStore(inner, { intervalMs: 1000 });

    await store.set("key-a", "cursor-a");
    expect(inner.setManyCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);

    expect(inner.setManyCalls).toHaveLength(1);
    expect(inner.setManyCalls[0]).toEqual({ "key-a": "cursor-a" });

    store.dispose();
  });

  it("timer does not fire after dispose()", async () => {
    const inner = new FakeInnerStore();
    const store = coalesceCursorStore(inner, { intervalMs: 1000 });

    await store.set("key-a", "cursor-a");
    store.dispose();

    await vi.advanceTimersByTimeAsync(2000);

    expect(inner.setManyCalls).toHaveLength(0);
  });

  it("dispose with buffered entries does not flush — entries are discarded", async () => {
    const inner = new FakeInnerStore();
    const store = coalesceCursorStore(inner, { intervalMs: 1000 });

    await store.set("key-a", "cursor-a");
    store.dispose();

    await vi.advanceTimersByTimeAsync(5000);

    expect(inner.setManyCalls).toHaveLength(0);
  });

  it("timer does not fire when buffer is empty", async () => {
    const inner = new FakeInnerStore();
    const store = coalesceCursorStore(inner, { intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3000);

    expect(inner.setManyCalls).toHaveLength(0);

    store.dispose();
  });
});
