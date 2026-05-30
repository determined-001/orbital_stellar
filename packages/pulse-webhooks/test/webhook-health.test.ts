import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital/pulse-core";
import {
  InMemoryRetryQueue,
  WebhookDelivery,
  type RetryQueue,
} from "../src/index.js";

const deliveryEvent = {
  type: "payment.received",
  to: "GDEST",
  from: "GSRC",
  amount: "10",
  asset: "XLM",
  timestamp: "2026-04-26T12:00:00.000Z",
  raw: { id: "evt_1" },
} as const;

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const baseConfig = {
  url: "https://prod.example.com/webhooks/stellar",
  secret: "top-secret",
} as const;

describe("pulse-webhooks WebhookDelivery.healthCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports healthy when running with no retry queue configured", async () => {
    const watcher = new Watcher("GABC");
    const delivery = new WebhookDelivery(watcher, baseConfig);

    const health = await delivery.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.queueReachable).toBe(true);
    expect(health.pendingRetries).toBe(0);
  });

  it("flips to unhealthy when a configured queue ping rejects", async () => {
    const watcher = new Watcher("GABC");
    const failingQueue: RetryQueue = {
      size: () => 0,
      ping: () => Promise.reject(new Error("backing store unreachable")),
    };
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      retryQueue: failingQueue,
    });

    const health = await delivery.healthCheck();

    expect(health.status).toBe("unhealthy");
    expect(health.queueReachable).toBe(false);
  });

  it("reports healthy when the in-memory reference queue pings successfully", async () => {
    const watcher = new Watcher("GABC");
    const queue = new InMemoryRetryQueue();
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      retryQueue: queue,
    });

    const health = await delivery.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.queueReachable).toBe(true);
  });

  it("reads pendingRetries from the queue's size() when a queue is configured", async () => {
    const watcher = new Watcher("GABC");
    const queue: RetryQueue = {
      size: () => 3,
      ping: () => Promise.resolve(),
    };
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      maxConcurrentRetries: 10,
      retryQueue: queue,
    });

    const health = await delivery.healthCheck();

    expect(health.pendingRetries).toBe(3);
    expect(health.status).toBe("healthy");
  });

  it("reports degraded when pending retries reach maxConcurrentRetries", async () => {
    const watcher = new Watcher("GABC");
    const saturatedQueue: RetryQueue = {
      size: () => 5,
      ping: () => Promise.resolve(),
    };
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      maxConcurrentRetries: 5,
      retryQueue: saturatedQueue,
    });

    const health = await delivery.healthCheck();

    expect(health.status).toBe("degraded");
    expect(health.pendingRetries).toBe(5);
  });

  it("lets a failing ping dominate over queue saturation", async () => {
    const watcher = new Watcher("GABC");
    const saturatedAndDown: RetryQueue = {
      size: () => 5,
      ping: () => Promise.reject(new Error("down")),
    };
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      maxConcurrentRetries: 5,
      retryQueue: saturatedAndDown,
    });

    const health = await delivery.healthCheck();

    expect(health.status).toBe("unhealthy");
    expect(health.queueReachable).toBe(false);
  });

  it("reports unhealthy once the watcher has stopped", async () => {
    const watcher = new Watcher("GABC");
    const delivery = new WebhookDelivery(watcher, baseConfig);

    watcher.stop();
    const health = await delivery.healthCheck();

    expect(health.status).toBe("unhealthy");
  });

  it("counts in-flight timer-based retries as pendingRetries without a queue", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      retries: 3,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    // First attempt failed; a retry timer is now pending.
    const health = await delivery.healthCheck();
    expect(health.pendingRetries).toBeGreaterThanOrEqual(1);
    expect(health.queueReachable).toBe(true);
  });

  it("treats a queue without a ping() as reachable", async () => {
    const watcher = new Watcher("GABC");
    const pinglessQueue: RetryQueue = { size: () => 0 };
    const delivery = new WebhookDelivery(watcher, {
      ...baseConfig,
      retryQueue: pinglessQueue,
    });

    const health = await delivery.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.queueReachable).toBe(true);
  });
});

describe("pulse-webhooks InMemoryRetryQueue", () => {
  it("enqueues, reports size, and dequeues FIFO", () => {
    const queue = new InMemoryRetryQueue();
    expect(queue.size()).toBe(0);

    queue.enqueue({ type: "payment.received", raw: { id: "a" } } as never);
    queue.enqueue({ type: "payment.received", raw: { id: "b" } } as never);
    expect(queue.size()).toBe(2);

    const first = queue.dequeue() as { raw: { id: string } } | undefined;
    expect(first?.raw.id).toBe("a");
    expect(queue.size()).toBe(1);
  });

  it("resolves ping() without throwing", async () => {
    const queue = new InMemoryRetryQueue();
    await expect(queue.ping()).resolves.toBeUndefined();
  });
});
