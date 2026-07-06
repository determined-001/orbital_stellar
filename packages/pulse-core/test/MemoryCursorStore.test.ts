import { describe, it, expect } from "vitest";
import { MemoryCursorStore } from "../src/MemoryCursorStore";

describe("MemoryCursorStore", () => {
  it("should store and retrieve cursor", async () => {
    const store = new MemoryCursorStore();

    await store.set("stream-1", "cursor-123");

    const result = await store.get("stream-1");

    expect(result).toBe("cursor-123");
  });

  describe("getAll", () => {
    it("returns empty array when store is empty", async () => {
      const store = new MemoryCursorStore();
      expect(await store.getAll()).toEqual([]);
    });

    it("returns all stored entries", async () => {
      const store = new MemoryCursorStore();
      await store.set("stream-a", "cursor-1");
      await store.set("stream-b", "cursor-2");

      const all = await store.getAll();
      expect(all).toHaveLength(2);
      expect(all).toEqual(
        expect.arrayContaining([
          { streamKey: "stream-a", cursor: "cursor-1" },
          { streamKey: "stream-b", cursor: "cursor-2" },
        ]),
      );
    });
  });
});
