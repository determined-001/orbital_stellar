import { describe, it, expect } from "vitest";
import { migrateCursors, type CursorStore } from "../src/index.js";

class InMemoryCursorStore implements CursorStore {
  private store = new Map<string, string>();

  async get(streamKey: string): Promise<string | null> {
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.store.set(streamKey, cursor);
  }

  async getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
    return Array.from(this.store.entries()).map(([streamKey, cursor]) => ({
      streamKey,
      cursor,
    }));
  }
}

describe("migrateCursors", () => {
  it("migrates all entries from source to target", async () => {
    const source = new InMemoryCursorStore();
    await source.set("stream-a", "cursor-1");
    await source.set("stream-b", "cursor-2");
    await source.set("stream-c", "cursor-3");

    const target = new InMemoryCursorStore();
    const result = await migrateCursors(source, target);

    expect(result).toEqual({ migrated: 3 });
    expect(await target.get("stream-a")).toBe("cursor-1");
    expect(await target.get("stream-b")).toBe("cursor-2");
    expect(await target.get("stream-c")).toBe("cursor-3");
  });

  it("overwrites existing keys in the target", async () => {
    const source = new InMemoryCursorStore();
    await source.set("stream-a", "new-cursor");

    const target = new InMemoryCursorStore();
    await target.set("stream-a", "old-cursor");
    await target.set("stream-other", "keep-me");

    const result = await migrateCursors(source, target);

    expect(result).toEqual({ migrated: 1 });
    expect(await target.get("stream-a")).toBe("new-cursor");
    expect(await target.get("stream-other")).toBe("keep-me");
  });

  it("returns { migrated: 0 } when source is empty", async () => {
    const source = new InMemoryCursorStore();
    const target = new InMemoryCursorStore();
    const result = await migrateCursors(source, target);

    expect(result).toEqual({ migrated: 0 });
  });

  it("idempotent - running twice produces the same result", async () => {
    const source = new InMemoryCursorStore();
    await source.set("stream-a", "cursor-1");

    const target = new InMemoryCursorStore();
    await migrateCursors(source, target);
    const result = await migrateCursors(source, target);

    expect(result).toEqual({ migrated: 1 });
    expect(await target.get("stream-a")).toBe("cursor-1");
  });

  it("migrates a unified-stream-keyed cursor (issue 6.14) with no special-casing needed", async () => {
    // CursorStore treats every cursor as an opaque string regardless of
    // source - migrateCursors needs no changes to carry the unified
    // transport's `unified:${network}` key alongside Horizon's and
    // Soroban's, exactly like any other stream key.
    const source = new InMemoryCursorStore();
    await source.set("horizon:testnet", "43989323223040-1");
    await source.set("soroban:testnet", "0015933813272113152-0000000001");
    await source.set("unified:testnet", "0015933813272113152-0000000000");

    const target = new InMemoryCursorStore();
    const result = await migrateCursors(source, target);

    expect(result).toEqual({ migrated: 3 });
    expect(await target.get("unified:testnet")).toBe("0015933813272113152-0000000000");
    expect(await target.get("horizon:testnet")).toBe("43989323223040-1");
    expect(await target.get("soroban:testnet")).toBe("0015933813272113152-0000000001");
  });
});
