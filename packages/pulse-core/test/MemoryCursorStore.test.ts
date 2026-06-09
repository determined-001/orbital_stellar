import { MemoryCursorStore } from "../src/MemoryCursorStore";

describe("MemoryCursorStore", () => {
  it("should store and retrieve cursor", async () => {
    const store = new MemoryCursorStore();

    await store.set("stream-1", "cursor-123");

    const result = await store.get("stream-1");

    expect(result).toBe("cursor-123");
  });
});
