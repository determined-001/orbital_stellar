import { describe, it, expect, vi } from "vitest";
import { MemoryRetryQueue } from "../src/RetryQueue.js";
import type { RetryRecord } from "../src/RetryQueue.js";
import { WebhookDelivery } from "../src/index.js";
import { Watcher } from "@orbital-stellar/pulse-core";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

function makeRecord(overrides: Partial<RetryRecord> = {}): RetryRecord {
  return {
    id: "https://example.com/hook",
    event: { type: "test", id: 1 },
    url: "https://example.com/hook",
    attempt: 1,
    nextRetryAt: Date.now() - 1000,
    createdAt: Date.now() - 5000,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
  }
}

describe("MemoryRetryQueue", () => {
  it("enqueue() adds a record and size() reflects the new count", async () => {
    const queue = new MemoryRetryQueue();
    expect(await queue.size()).toBe(0);

    await queue.enqueue(makeRecord());
    expect(await queue.size()).toBe(1);

    await queue.enqueue(makeRecord());
    expect(await queue.size()).toBe(2);
  });

  it("dequeue() returns a record whose nextRetryAt is in the past and removes it from the queue", async () => {
    const queue = new MemoryRetryQueue();
    const record = makeRecord({ nextRetryAt: Date.now() - 5000 });
    await queue.enqueue(record);

    const dequeued = await queue.dequeue();
    expect(dequeued).toEqual(record);
    expect(await queue.size()).toBe(0);
  });

  it("dequeue() returns null when no record is due (nextRetryAt is in the future)", async () => {
    const queue = new MemoryRetryQueue();
    await queue.enqueue(makeRecord({ nextRetryAt: Date.now() + 100_000 }));

    const result = await queue.dequeue();
    expect(result).toBeNull();
    expect(await queue.size()).toBe(1);
  });

  it("dequeue() returns the oldest due record when multiple records are due", async () => {
    const queue = new MemoryRetryQueue();
    const early = makeRecord({ id: "a", nextRetryAt: Date.now() - 2000 });
    const late = makeRecord({ id: "b", nextRetryAt: Date.now() - 1000 });
    await queue.enqueue(early);
    await queue.enqueue(late);

    expect(await queue.dequeue()).toEqual(early);
    expect(await queue.dequeue()).toEqual(late);
    expect(await queue.size()).toBe(0);
  });

  it("evictNewest() removes and returns the most recently enqueued record", async () => {
    const queue = new MemoryRetryQueue();
    const first = makeRecord({ id: "a" });
    const second = makeRecord({ id: "b" });
    const third = makeRecord({ id: "c" });
    await queue.enqueue(first);
    await queue.enqueue(second);
    await queue.enqueue(third);

    const evicted = await queue.evictNewest();
    expect(evicted).toEqual(third);
    expect(await queue.size()).toBe(2);

    expect(await queue.dequeue()).toEqual(first);
    expect(await queue.dequeue()).toEqual(second);
  });

  it("evictNewest() returns null on an empty queue", async () => {
    const queue = new MemoryRetryQueue();
    expect(await queue.evictNewest()).toBeNull();
  });

  it("Round-trip: enqueue then dequeue returns the same record", async () => {
    const queue = new MemoryRetryQueue();
    const record = makeRecord({
      id: "https://example.com/hook",
      event: { type: "payment", id: 42 },
      attempt: 2,
      nextRetryAt: Date.now() - 100,
      createdAt: Date.now() - 10000,
    });
    await queue.enqueue(record);

    const dequeued = await queue.dequeue();
    expect(dequeued).toEqual(record);
    expect(dequeued?.id).toBe("https://example.com/hook");
    expect(dequeued?.event).toEqual({ type: "payment", id: 42 });
    expect(dequeued?.attempt).toBe(2);
    expect(dequeued?.nextRetryAt).toBe(record.nextRetryAt);
    expect(dequeued?.createdAt).toBe(record.createdAt);
  });
});

describe("WebhookDelivery with MemoryRetryQueue integration", () => {
  it("WebhookDelivery configured with a MemoryRetryQueue enqueues a failed delivery through the queue", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

    try {
      const watcher = new Watcher({ strictStoppedListeners: false });
      const queue = new MemoryRetryQueue();
      const enqueueSpy = vi.spyOn(queue, "enqueue");

      new WebhookDelivery(watcher, {
        url: "https://mock-receiver.com/webhook",
        secret: "test-secret",
        retries: 3,
        retryQueue: queue,
      });

      const testEvent: NormalizedEvent = {
        type: "payment.received",
        to: "GABC",
        from: "GDEF",
        amount: "100",
        asset: "XLM",
        timestamp: new Date().toISOString(),
        raw: {},
      };

      watcher.emit("*", testEvent);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const [record] = enqueueSpy.mock.calls[0] as [RetryRecord];
      expect(record.id).toBe("https://mock-receiver.com/webhook");
      expect(record.event).toEqual(testEvent);
      expect(record.attempt).toBe(1);
      expect(typeof record.nextRetryAt).toBe("number");
      expect(typeof record.createdAt).toBe("number");

      watcher.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("WebhookDelivery with no retryQueue configured retries via the existing in-process path unchanged", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher({ strictStoppedListeners: false });
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 2,
    });

    const testEvent: NormalizedEvent = {
      type: "payment.received",
      to: "GABC",
      from: "GDEF",
      amount: "100",
      asset: "XLM",
      timestamp: new Date().toISOString(),
      raw: { id: "evt_1" },
    };

    watcher.emit("*", testEvent);
    await flushAsyncWork();

    // First attempt happened
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance time past the retry backoff (max 999ms for attempt 1)
    vi.advanceTimersByTime(2000);
    await flushAsyncWork();

    // Retry happened via the in-process timer — no retryQueue needed
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
