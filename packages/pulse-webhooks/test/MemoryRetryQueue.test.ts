import { describe, expect, it } from "vitest";

import { MemoryRetryQueue, type RetryRecord } from "../src/index.js";

function makeRecord(
  id: string,
  nextRetryAt: number,
  overrides: Partial<RetryRecord> = {},
): RetryRecord {
  return {
    id,
    event: { id },
    url: "https://example.com/hook",
    attempt: 1,
    nextRetryAt,
    ...overrides,
  };
}

describe("MemoryRetryQueue", () => {
  describe("round-trip", () => {
    it("enqueues and dequeues an identical record", async () => {
      const queue = new MemoryRetryQueue({ now: () => 1000 });
      const record = makeRecord("a", 500, { lastError: "HTTP 500", attempt: 2 });

      await queue.enqueue(record);
      expect(await queue.size()).toBe(1);

      const out = await queue.dequeue(1000);
      expect(out).toEqual(record);
      expect(await queue.size()).toBe(0);
    });

    it("does not alias the caller's record (stores a copy)", async () => {
      const queue = new MemoryRetryQueue({ now: () => 1000 });
      const record = makeRecord("a", 500);
      await queue.enqueue(record);

      record.attempt = 99; // mutate after enqueue

      const out = await queue.dequeue(1000);
      expect(out?.attempt).toBe(1);
    });

    it("returns the earliest-due record first", async () => {
      const queue = new MemoryRetryQueue();
      await queue.enqueue(makeRecord("late", 300));
      await queue.enqueue(makeRecord("early", 100));

      expect((await queue.dequeue(1000))?.id).toBe("early");
      expect((await queue.dequeue(1000))?.id).toBe("late");
    });

    it("returns null and leaves the record queued when nothing is due", async () => {
      const queue = new MemoryRetryQueue();
      await queue.enqueue(makeRecord("future", 5000));

      expect(await queue.dequeue(1000)).toBeNull();
      expect(await queue.size()).toBe(1);
    });
  });

  describe("eviction", () => {
    it("evictNewest removes and returns the furthest-future record", async () => {
      const queue = new MemoryRetryQueue();
      await queue.enqueue(makeRecord("a", 100));
      await queue.enqueue(makeRecord("c", 300));
      await queue.enqueue(makeRecord("b", 200));

      const evicted = await queue.evictNewest();
      expect(evicted?.id).toBe("c");
      expect(await queue.size()).toBe(2);

      // The remaining records are untouched and still dequeue in due order.
      expect((await queue.dequeue(1000))?.id).toBe("a");
      expect((await queue.dequeue(1000))?.id).toBe("b");
    });

    it("evictNewest returns null on an empty queue", async () => {
      const queue = new MemoryRetryQueue();
      expect(await queue.evictNewest()).toBeNull();
    });
  });

  describe("in-flight visibility (ack / nack / reclaim)", () => {
    it("ack removes an in-flight record so it is not reclaimed", async () => {
      let clock = 1000;
      const queue = new MemoryRetryQueue({ now: () => clock, visibilityTimeoutMs: 100 });
      await queue.enqueue(makeRecord("a", 500));

      const taken = await queue.dequeue(clock);
      expect(taken?.id).toBe("a");
      await queue.ack("a");

      clock = 999_999; // well past the visibility window
      expect(await queue.dequeue(clock)).toBeNull();
      expect(await queue.size()).toBe(0);
    });

    it("reclaims an un-acked record once its visibility timeout lapses", async () => {
      const queue = new MemoryRetryQueue({ visibilityTimeoutMs: 100 });
      await queue.enqueue(makeRecord("a", 500));

      expect((await queue.dequeue(1000))?.id).toBe("a"); // in-flight, expires at 1100
      expect(await queue.dequeue(1050)).toBeNull(); // still in-flight
      expect((await queue.dequeue(1200))?.id).toBe("a"); // reclaimed and re-delivered
    });

    it("nack re-enqueues the record with a delay", async () => {
      const queue = new MemoryRetryQueue({ now: () => 1000 });
      await queue.enqueue(makeRecord("a", 500));
      await queue.dequeue(1000);

      await queue.nack("a", 200); // re-schedule for now (1000) + 200
      expect(await queue.size()).toBe(1);
      expect(await queue.dequeue(1100)).toBeNull(); // not due yet

      const out = await queue.dequeue(1300);
      expect(out?.id).toBe("a");
      expect(out?.nextRetryAt).toBe(1200);
    });

    it("ack and nack are no-ops for an unknown record id", async () => {
      const queue = new MemoryRetryQueue();
      await expect(queue.ack("missing")).resolves.toBeUndefined();
      await expect(queue.nack("missing", 100)).resolves.toBeUndefined();
      expect(await queue.size()).toBe(0);
    });
  });

  describe("validation", () => {
    it("rejects a record without an id", async () => {
      const queue = new MemoryRetryQueue();
      await expect(queue.enqueue(makeRecord("", 100))).rejects.toThrow(
        "RetryRecord.id is required",
      );
    });

    it("rejects a record with a non-finite nextRetryAt", async () => {
      const queue = new MemoryRetryQueue();
      await expect(queue.enqueue(makeRecord("a", Number.NaN))).rejects.toThrow(
        "RetryRecord.nextRetryAt must be a finite timestamp",
      );
    });
  });
});
