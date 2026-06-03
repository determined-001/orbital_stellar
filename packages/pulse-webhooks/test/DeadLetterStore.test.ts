import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Watcher } from "@orbital/pulse-core";

import {
  MemoryDeadLetterStore,
  WebhookDelivery,
} from "../src/index.js";
import type { FailureRecord } from "../src/index.js";

describe("MemoryDeadLetterStore", () => {
  let store: MemoryDeadLetterStore;

  beforeEach(() => {
    store = new MemoryDeadLetterStore();
  });

  it("record() stores a failure and list() returns it", () => {
    const record: FailureRecord = {
      eventType: "webhook.failed",
      webhookId: "https://example.com/hook",
      payload: { type: "payment.received" },
      reason: "HTTP 500",
      timestamp: 1000,
      attemptCount: 3,
    };

    store.record(record);
    const results = store.list();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(record);
  });

  it("list() with eventType filter returns only matching records", () => {
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://example.com/hook",
      payload: {},
      reason: "HTTP 500",
      timestamp: 1000,
      attemptCount: 3,
    });
    store.record({
      eventType: "webhook.dropped",
      webhookId: "https://example.com/hook",
      payload: {},
      reason: "retry_cap_exceeded",
      timestamp: 2000,
      attemptCount: 2,
    });

    const failed = store.list({ eventType: "webhook.failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0].eventType).toBe("webhook.failed");

    const dropped = store.list({ eventType: "webhook.dropped" });
    expect(dropped).toHaveLength(1);
    expect(dropped[0].eventType).toBe("webhook.dropped");
  });

  it("list() with since filter returns only records after that timestamp", () => {
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://example.com/hook",
      payload: {},
      reason: "error 1",
      timestamp: 100,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://example.com/hook",
      payload: {},
      reason: "error 2",
      timestamp: 200,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://example.com/hook",
      payload: {},
      reason: "error 3",
      timestamp: 300,
      attemptCount: 1,
    });

    const results = store.list({ since: 150 });
    expect(results).toHaveLength(2);
    expect(results[0].reason).toBe("error 2");
    expect(results[1].reason).toBe("error 3");
  });

  it("list() with webhookId filter returns only matching records", () => {
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://hook1.com",
      payload: {},
      reason: "error",
      timestamp: 100,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://hook2.com",
      payload: {},
      reason: "error",
      timestamp: 200,
      attemptCount: 1,
    });

    const results = store.list({ webhookId: "https://hook1.com" });
    expect(results).toHaveLength(1);
    expect(results[0].webhookId).toBe("https://hook1.com");
  });

  it("combined filters apply as AND conditions", () => {
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://hook1.com",
      payload: {},
      reason: "err1",
      timestamp: 100,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.dropped",
      webhookId: "https://hook1.com",
      payload: {},
      reason: "drop",
      timestamp: 200,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://hook2.com",
      payload: {},
      reason: "err2",
      timestamp: 300,
      attemptCount: 1,
    });

    const results = store.list({
      eventType: "webhook.failed",
      webhookId: "https://hook1.com",
    });
    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe("webhook.failed");
    expect(results[0].webhookId).toBe("https://hook1.com");
  });

  it("evicts the oldest record when the cap is exceeded and the newest record is retained", () => {
    const smallStore = new MemoryDeadLetterStore(3);

    smallStore.record({
      eventType: "webhook.failed",
      webhookId: "https://hook1.com",
      payload: {},
      reason: "err1",
      timestamp: 100,
      attemptCount: 1,
    });
    smallStore.record({
      eventType: "webhook.failed",
      webhookId: "https://hook2.com",
      payload: {},
      reason: "err2",
      timestamp: 200,
      attemptCount: 1,
    });
    smallStore.record({
      eventType: "webhook.failed",
      webhookId: "https://hook3.com",
      payload: {},
      reason: "err3",
      timestamp: 300,
      attemptCount: 1,
    });
    // This insert should evict hook1 (oldest)
    smallStore.record({
      eventType: "webhook.failed",
      webhookId: "https://hook4.com",
      payload: {},
      reason: "err4",
      timestamp: 400,
      attemptCount: 1,
    });

    const results = smallStore.list();
    expect(results).toHaveLength(3);
    expect(results[0].webhookId).toBe("https://hook2.com");
    expect(results[1].webhookId).toBe("https://hook3.com");
    expect(results[2].webhookId).toBe("https://hook4.com");
  });

  it("list() with no filter or empty filter returns all records", () => {
    store.record({
      eventType: "webhook.failed",
      webhookId: "https://hook1.com",
      payload: {},
      reason: "err",
      timestamp: 100,
      attemptCount: 1,
    });
    store.record({
      eventType: "webhook.dropped",
      webhookId: "https://hook2.com",
      payload: {},
      reason: "drop",
      timestamp: 200,
      attemptCount: 1,
    });

    expect(store.list()).toHaveLength(2);
    expect(store.list({})).toHaveLength(2);
    expect(store.list(undefined)).toHaveLength(2);
  });
});

describe("WebhookDelivery DeadLetterStore integration", () => {
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
    for (let i = 0; i < 100; i++) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("webhook.failed automatically records to a configured store", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");

    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 1,
      deadLetterStore: store,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    const records = store.list();
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe("webhook.failed");
    expect(records[0].webhookId).toBe("https://example.com/hook");
    expect(records[0].reason).toBe("network down");
    expect(records[0].attemptCount).toBe(1);
    expect(records[0].payload).toEqual(deliveryEvent);
  });

  it("webhook.dropped automatically records to a configured store", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    const droppedHandler = vi.fn();
    watcher.on("webhook.dropped", droppedHandler);

    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 3,
      maxConcurrentRetries: 1,
      deadLetterStore: store,
    });

    const event1 = { ...deliveryEvent, raw: { id: "evt_1" } };
    const event2 = { ...deliveryEvent, raw: { id: "evt_2" } };

    watcher.emit("*", event1);
    watcher.emit("*", event2);
    await flushAsyncWork();

    // Event 1's retry was evicted -> webhook.dropped emitted -> store recorded it
    expect(droppedHandler).toHaveBeenCalledTimes(1);

    const records = store.list();
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe("webhook.dropped");
    expect(records[0].reason).toBe("retry_cap_exceeded");
    expect(records[0].webhookId).toBe("https://example.com/hook");
  });

  it("no store configured — webhook.failed and webhook.dropped emit normally with no error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    const droppedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);
    watcher.on("webhook.dropped", droppedHandler);

    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 1,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(failedHandler).toHaveBeenCalledTimes(1);
    expect(droppedHandler).not.toHaveBeenCalled();
  });
});
