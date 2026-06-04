import { describe, it, expect } from "vitest";
import { CursorStore } from "../src/CursorStore.js";

// ---------------------------------------------------------------------------
// Minimal concrete stub — records all get/set calls for assertion
// ---------------------------------------------------------------------------

class StubCursorStore extends CursorStore {
  private readonly store: Map<string, string> = new Map();
  readonly getCalls: string[] = [];
  readonly setCalls: Array<{ key: string; value: string }> = [];

  /** Optionally inject an error to throw on the next get call */
  getError: Error | null = null;
  /** Optionally inject an error to throw on the next set call */
  setError: Error | null = null;

  async get(streamKey: string): Promise<string | null> {
    this.getCalls.push(streamKey);
    if (this.getError) throw this.getError;
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.setCalls.push({ key: streamKey, value: cursor });
    if (this.setError) throw this.setError;
    this.store.set(streamKey, cursor);
  }
}

// ---------------------------------------------------------------------------
// Tests for the default CursorStore.getMany / setMany implementations
// ---------------------------------------------------------------------------

describe("CursorStore default batch implementations", () => {
  describe("getMany", () => {
    it("returns {} for an empty keys array without calling get", async () => {
      const store = new StubCursorStore();
      const result = await store.getMany([]);
      expect(result).toEqual({});
      expect(store.getCalls).toHaveLength(0);
    });

    it("calls get once per key and returns a correctly mapped record", async () => {
      const store = new StubCursorStore();
      await store.set("key-a", "cursor-1");
      await store.set("key-b", "cursor-2");
      store.getCalls.length = 0; // reset after setup sets

      const result = await store.getMany(["key-a", "key-b"]);

      expect(store.getCalls).toEqual(["key-a", "key-b"]);
      expect(result).toEqual({ "key-a": "cursor-1", "key-b": "cursor-2" });
    });

    it("maps keys with no stored cursor to null", async () => {
      const store = new StubCursorStore();
      const result = await store.getMany(["missing-key"]);
      expect(result).toEqual({ "missing-key": null });
    });

    it("includes null values for missing keys alongside found values", async () => {
      const store = new StubCursorStore();
      await store.set("exists", "abc");
      store.getCalls.length = 0;

      const result = await store.getMany(["exists", "missing"]);
      expect(result).toEqual({ exists: "abc", missing: null });
    });

    it("propagates errors thrown by get without suppressing them", async () => {
      const store = new StubCursorStore();
      store.getError = new Error("get failed");
      await expect(store.getMany(["any-key"])).rejects.toThrow("get failed");
    });
  });

  describe("setMany", () => {
    it("returns without calling set for an empty entries object", async () => {
      const store = new StubCursorStore();
      await store.setMany({});
      expect(store.setCalls).toHaveLength(0);
    });

    it("calls set once per entry with correct key-value pairs", async () => {
      const store = new StubCursorStore();
      await store.setMany({ "key-x": "val-1", "key-y": "val-2" });

      expect(store.setCalls).toHaveLength(2);
      // Order follows Object.entries iteration order
      expect(store.setCalls).toContainEqual({ key: "key-x", value: "val-1" });
      expect(store.setCalls).toContainEqual({ key: "key-y", value: "val-2" });
    });

    it("persists values so they are retrievable via get", async () => {
      const store = new StubCursorStore();
      await store.setMany({ stream1: "cursor-a", stream2: "cursor-b" });

      expect(await store.get("stream1")).toBe("cursor-a");
      expect(await store.get("stream2")).toBe("cursor-b");
    });

    it("propagates errors thrown by set without suppressing them", async () => {
      const store = new StubCursorStore();
      store.setError = new Error("set failed");
      await expect(store.setMany({ "any-key": "any-val" })).rejects.toThrow("set failed");
    });
  });
});
