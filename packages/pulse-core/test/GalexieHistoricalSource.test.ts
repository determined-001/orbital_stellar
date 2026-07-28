import { describe, it, expect, vi } from "vitest";
import {
  GalexieHistoricalSource,
  GalexiePartitionError,
} from "../src/GalexieHistoricalSource.js";

const BUCKET = "https://example.com/bucket";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("GalexieHistoricalSource", () => {
  describe("canServe", () => {
    it("HEADs the first partition covering the range and returns true on 200", async () => {
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const source = new GalexieHistoricalSource({ bucketBaseUrl: BUCKET, transport });

      const result = await source.canServe({ startLedger: 100, endLedger: 200 });

      expect(result).toBe(true);
      // 100 falls in the [64, 128) partition (default ledgersPerFile = 64).
      expect(transport).toHaveBeenCalledWith(`${BUCKET}/ledgers/64-128.xdr.gz`, { method: "HEAD" });
    });

    it("returns false when the HEAD request 404s", async () => {
      const transport = vi.fn().mockResolvedValue({ ok: false });
      const source = new GalexieHistoricalSource({ bucketBaseUrl: BUCKET, transport });

      expect(await source.canServe({ startLedger: 100, endLedger: 200 })).toBe(false);
    });

    it("returns false when the transport itself throws (network error)", async () => {
      const transport = vi.fn().mockRejectedValue(new Error("network down"));
      const source = new GalexieHistoricalSource({ bucketBaseUrl: BUCKET, transport });

      expect(await source.canServe({ startLedger: 100, endLedger: 200 })).toBe(false);
    });
  });

  describe("replay - partitioning and error surfacing", () => {
    it("requests one partition file per ledgersPerFile-sized chunk covering the range", async () => {
      const transport = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const source = new GalexieHistoricalSource({
        bucketBaseUrl: BUCKET,
        ledgersPerFile: 10,
        transport,
      });

      await expect(collect(source.replay({ startLedger: 5, endLedger: 25 }))).rejects.toThrow(
        GalexiePartitionError,
      );

      // Range [5, 25) with 10-ledger partitions spans [0,10), [10,20), [20,30) -
      // the first fetch (partition 0-10) is what fails and throws.
      expect(transport).toHaveBeenCalledWith(`${BUCKET}/ledgers/0-10.xdr.gz`);
    });

    it("wraps a fetch failure in GalexiePartitionError naming the object key", async () => {
      const transport = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const source = new GalexieHistoricalSource({
        bucketBaseUrl: BUCKET,
        ledgersPerFile: 64,
        transport,
      });

      await expect(collect(source.replay({ startLedger: 0, endLedger: 10 }))).rejects.toThrow(
        /ledgers\/0-64\.xdr\.gz/,
      );
    });

    it("respects a custom objectKeyForLedger convention", async () => {
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const objectKeyForLedger = vi.fn((start: number, end: number) => `custom/${start}_${end}.bin`);
      const source = new GalexieHistoricalSource({
        bucketBaseUrl: BUCKET,
        transport,
        objectKeyForLedger,
      });

      await source.canServe({ startLedger: 0, endLedger: 64 });

      expect(objectKeyForLedger).toHaveBeenCalledWith(0, 64);
      expect(transport).toHaveBeenCalledWith(`${BUCKET}/custom/0_64.bin`, { method: "HEAD" });
    });
  });
});
