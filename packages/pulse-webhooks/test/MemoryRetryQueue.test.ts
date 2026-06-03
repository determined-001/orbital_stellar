import { describe, it, expect, vi } from "vitest";
import { MemoryRetryQueue } from "../src/RetryQueue.js";
import type { RetryRecord } from "../src/RetryQueue.js";
import { WebhookDelivery } from "../src/index.js";
import { Watcher } from "@orbital/pulse-core";
import type { NormalizedEvent } from "@orbital/pulse-core";

function makeRecord(overrides: Partial<RetryRecord> = {}): RetryRecord {
  return {
    webhookId: "https://example.com/hook",
    payload: { type: "test", id: 1 },
    attemptCount: 1,
    nextRetryAt: Date.now() - 1000,
    createdAt: Date.now() - 5000,
    url: "https://example.com/hook",
    event: { type: "test", id: 1 },
    attempt: 1,
    nextAttemptAt: Date.now() - 1000,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
  }
}

describe("MemoryRetryQueue", () => {
  it("enqueue() adds a record and size() reflects the new count", () => {
    const queue = new MemoryRetryQueue();
    expect(queue.size()).toBe(0);

    queue.enqueue(makeRecord());
    expect(queue.size()).toBe(1);

    queue.enqueue(makeRecord());
    expect(queue.size()).toBe(2);
  });

  it("dequeue() returns a record whose nextRetryAt is in the past and removes it from the queue", () => {
    const queue = new MemoryRetryQueue();
    const record = makeRecord({ nextRetryAt: Date.now() - 5000 });
    queue.enqueue(record);

    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(record);
    expect(queue.size()).toBe(0);
  });

  it("dequeue() returns undefined when no record is due (nextRetryAt is in the future)", () => {
    const queue = new MemoryRetryQueue();
    queue.enqueue(makeRecord({ nextRetryAt: Date.now() + 100_000 }));

    const result = queue.dequeue();
    expect(result).toBeUndefined();
    expect(queue.size()).toBe(1);
  });

  it("dequeue() returns the oldest due record when multiple records are due", () => {
    const queue = new MemoryRetryQueue();
    const early = makeRecord({ webhookId: "a", nextRetryAt: Date.now() - 2000 });
    const late = makeRecord({ webhookId: "b", nextRetryAt: Date.now() - 1000 });
    queue.enqueue(early);
    queue.enqueue(late);

    expect(queue.dequeue()).toEqual(early);
    expect(queue.dequeue()).toEqual(late);
    expect(queue.size()).toBe(0);
  });

  it("evictNewest() removes and returns the most recently enqueued record", () => {
    const queue = new MemoryRetryQueue();
    const first = makeRecord({ webhookId: "a" });
    const second = makeRecord({ webhookId: "b" });
    const third = makeRecord({ webhookId: "c" });
    queue.enqueue(first);
    queue.enqueue(second);
    queue.enqueue(third);

    const evicted = queue.evictNewest();
    expect(evicted).toEqual(third);
    expect(queue.size()).toBe(2);

    expect(queue.dequeue()).toEqual(first);
    expect(queue.dequeue()).toEqual(second);
  });

  it("evictNewest() returns undefined on an empty queue", () => {
    const queue = new MemoryRetryQueue();
    expect(queue.evictNewest()).toBeUndefined();
  });

  it("Round-trip: enqueue then dequeue returns the same record", () => {
    const queue = new MemoryRetryQueue();
    const record = makeRecord({
      webhookId: "https://example.com/hook",
      payload: { type: "payment", id: 42 },
      attemptCount: 2,
      nextRetryAt: Date.now() - 100,
      createdAt: Date.now() - 10000,
    });
    queue.enqueue(record);

    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(record);
    expect(dequeued?.webhookId).toBe("https://example.com/hook");
    expect(dequeued?.payload).toEqual({ type: "payment", id: 42 });
    expect(dequeued?.attemptCount).toBe(2);
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
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const [record] = enqueueSpy.mock.calls[0] as [RetryRecord];
      expect(record.webhookId).toBe("https://mock-receiver.com/webhook");
      expect(record.payload).toEqual(testEvent);
      expect(record.attemptCount).toBe(1);
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
