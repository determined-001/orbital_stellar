import { describe, it, expect, vi } from "vitest";
import { MemoryRetryQueue } from "../src/RetryQueue.js";
import { WebhookDelivery } from "../src/index.js";
import type { RetryQueue, RetryRecord } from "../src/types.js";
import { Watcher } from "@orbital/pulse-core";
import type { NormalizedEvent } from "@orbital/pulse-core";

describe("MemoryRetryQueue", () => {
  it("should pass round-trip FIFO tests", async () => {
    const queue = new MemoryRetryQueue();
    expect(await queue.size()).toBe(0);

    const record1: RetryRecord = { url: "https://url1.com", event: { id: 1 }, attempt: 1, nextAttemptAt: 1000 };
    const record2: RetryRecord = { url: "https://url2.com", event: { id: 2 }, attempt: 1, nextAttemptAt: 2000 };

    await queue.enqueue(record1);
    await queue.enqueue(record2);

    expect(await queue.size()).toBe(2);

    const first = await queue.dequeue();
    expect(first).toEqual(record1);
    expect(await queue.size()).toBe(1);

    const second = await queue.dequeue();
    expect(second).toEqual(record2);
    expect(await queue.size()).toBe(0);

    expect(await queue.dequeue()).toBeNull();
  });

  it("should support LIFO eviction with evictNewest", async () => {
    const queue = new MemoryRetryQueue();

    const record1: RetryRecord = { url: "https://url1.com", event: { id: 1 }, attempt: 1, nextAttemptAt: 1000 };
    const record2: RetryRecord = { url: "https://url2.com", event: { id: 2 }, attempt: 1, nextAttemptAt: 2000 };
    const record3: RetryRecord = { url: "https://url3.com", event: { id: 3 }, attempt: 1, nextAttemptAt: 3000 };

    await queue.enqueue(record1);
    await queue.enqueue(record2);
    await queue.enqueue(record3);

    // Evict the newest (last-inserted, record3)
    const evicted = await queue.evictNewest();
    expect(evicted).toEqual(record3);
    expect(await queue.size()).toBe(2);

    // Dequeue remaining in FIFO order (record1 then record2)
    expect(await queue.dequeue()).toEqual(record1);
    expect(await queue.dequeue()).toEqual(record2);
    expect(await queue.size()).toBe(0);
  });
});

describe("WebhookDelivery with custom RetryQueue integration", () => {
  it("should persist retries through the custom queue", async () => {
    // We mock global fetch to fail to trigger the retry path
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

    try {
      const watcher = new Watcher({ strictStoppedListeners: false });
      const customQueue: RetryQueue = {
        enqueue: vi.fn().mockResolvedValue(undefined),
        dequeue: vi.fn().mockResolvedValue(null),
        evictNewest: vi.fn().mockResolvedValue(null),
        size: vi.fn().mockResolvedValue(0),
      };

      const delivery = new WebhookDelivery(watcher, {
        url: "https://mock-receiver.com/webhook",
        secret: "test-secret",
        retries: 3,
        retryQueue: customQueue,
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

      // Emit event to watcher to trigger WebhookDelivery
      watcher.emit("*", testEvent);

      // Give event loop/promise microtasks a moment to run deliverToUrl and then fail and enqueue
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify custom queue enqueue was called
      expect(customQueue.enqueue).toHaveBeenCalledTimes(1);
      const [record] = (customQueue.enqueue as any).mock.calls[0] as [RetryRecord];
      expect(record.url).toBe("https://mock-receiver.com/webhook");
      expect(record.event).toEqual(testEvent);
      expect(record.attempt).toBe(1);
      expect(typeof record.nextAttemptAt).toBe("number");

      // Verify clearRetryTimers cleans up timers
      watcher.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
