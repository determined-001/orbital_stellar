import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileCursorStore } from "../src/FileCursorStore.js";
import fs from "fs";
import path from "path";
import os from "os";

const mkdtemp = (prefix = "filecursor-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("FileCursorStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtemp();
  });

  afterEach(() => {
    // remove temp dir recursively
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("round-trips cursors across instances", async () => {
    const store1 = new FileCursorStore(dir);
    const key = "test-stream-rt";
    const val = "cursor-abc-123";

    await store1.set(key, val);

    const store2 = new FileCursorStore(dir);
    const read = await store2.get(key);
    expect(read).toBe(val);
  });

  describe("getAll", () => {
    it("returns empty array when directory does not exist", async () => {
      const store = new FileCursorStore("/tmp/nonexistent-dir-pulse-test");
      expect(await store.getAll()).toEqual([]);
    });

    it("returns all stored entries", async () => {
      const store = new FileCursorStore(dir);
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

    it("skips non-JSON files", async () => {
      const store = new FileCursorStore(dir);
      await store.set("stream-a", "cursor-1");
      fs.writeFileSync(path.join(dir, "README.txt"), "not a cursor file");

      const all = await store.getAll();
      expect(all).toEqual([{ streamKey: "stream-a", cursor: "cursor-1" }]);
    });

    it("round-trips stream keys with special characters", async () => {
      const store = new FileCursorStore(dir);
      const key = "stream/with:special chars&more";
      await store.set(key, "cursor-special");

      const all = await store.getAll();
      expect(all).toEqual([{ streamKey: key, cursor: "cursor-special" }]);
    });
  });

  it("returns null and warns on corrupted JSON file", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new FileCursorStore(dir, logger);
    const key = "test-corrupt";
    const filename = path.join(dir, encodeURIComponent(key) + ".json");

    // create dir and write invalid JSON
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filename, "{ not valid json", "utf8");

    const result = await store.get(key);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
