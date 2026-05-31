import { describe, it, expect, vi, beforeEach } from "vitest";
import { DlqStore } from "../src/DlqStore.js";
import type { PgClient, DlqEntry } from "../src/dlq.types.js";
import type { NormalizedEvent } from "@orbital/pulse-core";

const SAMPLE_EVENT: NormalizedEvent = {
  type: "payment.received",
  to: "GDEST",
  from: "GSRC",
  amount: "10",
  asset: "XLM",
  timestamp: "2026-01-01T00:00:00Z",
  raw: {},
};

const SAMPLE_ENTRY: DlqEntry = {
  id: "abc-123",
  address: "GDEST",
  url: "https://example.com/hook",
  attempts: 3,
  last_error: "HTTP 500",
  payload: SAMPLE_EVENT,
  created_at: "2026-01-01T00:00:00Z",
  replayed_at: null,
};

function makePg(rows: unknown[] = []): PgClient {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("DlqStore", () => {
  describe("push", () => {
    it("inserts a row with the correct parameters", async () => {
      const db = makePg();
      const store = new DlqStore(db);
      await store.push("GDEST", "https://example.com/hook", 3, "HTTP 500", SAMPLE_EVENT);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO dlq_events"),
        ["GDEST", "https://example.com/hook", 3, "HTTP 500", JSON.stringify(SAMPLE_EVENT)]
      );
    });
  });

  describe("list", () => {
    it("passes null when no since filter is provided", async () => {
      const db = makePg([SAMPLE_ENTRY]);
      const store = new DlqStore(db);
      const result = await store.list();

      expect(db.query).toHaveBeenCalledWith(expect.any(String), [null]);
      expect(result).toEqual([SAMPLE_ENTRY]);
    });

    it("passes the since value when provided", async () => {
      const db = makePg([]);
      const store = new DlqStore(db);
      await store.list("2026-01-01T00:00:00Z");

      expect(db.query).toHaveBeenCalledWith(expect.any(String), ["2026-01-01T00:00:00Z"]);
    });
  });

  describe("dump", () => {
    it("returns all rows without a filter parameter", async () => {
      const db = makePg([SAMPLE_ENTRY]);
      const store = new DlqStore(db);
      const result = await store.dump();

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
      expect(result).toEqual([SAMPLE_ENTRY]);
    });
  });

  describe("markReplayed", () => {
    it("returns the payload when the entry exists and is not yet replayed", async () => {
      const db = makePg([{ payload: SAMPLE_EVENT }]);
      const store = new DlqStore(db);
      const result = await store.markReplayed("abc-123");

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE dlq_events"),
        ["abc-123"]
      );
      expect(result).toEqual(SAMPLE_EVENT);
    });

    it("returns null when the entry is not found or already replayed", async () => {
      const db = makePg([]);
      const store = new DlqStore(db);
      expect(await store.markReplayed("missing")).toBeNull();
    });
  });
});
