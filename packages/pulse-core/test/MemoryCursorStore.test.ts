import { describe, it, expect } from "vitest";
import { MemoryCursorStore } from "../src/CursorStore.js";

describe("MemoryCursorStore", () => {
  it("round-trips a cursor for a given stream key", async () => {
    const store = new MemoryCursorStore();
    const key = "stream:address:GABC";
    const cursor = "now_12345";

    await store.set(key, cursor);
    const got = await store.get(key);

    expect(got).toBe(cursor);
  });

  it("returns null for missing keys", async () => {
    const store = new MemoryCursorStore();
    const got = await store.get("does-not-exist");
    expect(got).toBeNull();
  });
});
