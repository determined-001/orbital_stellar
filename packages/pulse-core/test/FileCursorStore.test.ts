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
