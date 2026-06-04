import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital/pulse-core";
import {
  MemoryDeadLetterStore,
  WebhookDelivery,
  type DeadLetterStore,
  type FailureRecord,
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

function makeFailure(
  overrides: Partial<FailureRecord> = {},
): FailureRecord {
  return {
    eventType: "webhook.failed",
    webhookId: "https://example.com/hook",
    payload: deliveryEvent,
    reason: "HTTP 500",
    timestamp: 1_000_000,
    attemptCount: 3,
    ...overrides,
  };
}

describe("MemoryDeadLetterStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("record() stores a failure and list() returns it", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const record = makeFailure();

    store.record(record);

    expect(store.list()).toEqual([record]);
  });

  it("list() with no filter returns all records", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const a = makeFailure({ webhookId: "https://a.com/hook", timestamp: 1 });
    const b = makeFailure({ webhookId: "https://b.com/hook", timestamp: 2 });

    store.record(a);
    store.record(b);

    expect(store.list()).toEqual([a, b]);
  });

  it("list() with eventType filter returns only matching records", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const failed = makeFailure({ eventType: "webhook.failed", timestamp: 1 });
    const dropped = makeFailure({ eventType: "webhook.dropped", timestamp: 2 });

    store.record(failed);
    store.record(dropped);

    expect(store.list({ eventType: "webhook.failed" })).toEqual([failed]);
    expect(store.list({ eventType: "webhook.dropped" })).toEqual([dropped]);
  });

  it("list() with since filter returns only records after that timestamp", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const early = makeFailure({ timestamp: 100 });
    const middle = makeFailure({ timestamp: 200 });
    const late = makeFailure({ timestamp: 300 });

    store.record(early);
    store.record(middle);
    store.record(late);

    expect(store.list({ since: 200 })).toEqual([middle, late]);
    expect(store.list({ since: 301 })).toEqual([]);
  });

  it("list() with webhookId filter returns only matching records", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const a = makeFailure({ webhookId: "https://a.com/hook", timestamp: 1 });
    const b = makeFailure({ webhookId: "https://b.com/hook", timestamp: 2 });

    store.record(a);
    store.record(b);

    expect(store.list({ webhookId: "https://a.com/hook" })).toEqual([a]);
    expect(store.list({ webhookId: "https://b.com/hook" })).toEqual([b]);
  });

  it("combined filters apply as AND conditions", () => {
    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const a = makeFailure({
      eventType: "webhook.failed",
      webhookId: "https://a.com/hook",
      timestamp: 100,
    });
    const b = makeFailure({
      eventType: "webhook.dropped",
      webhookId: "https://a.com/hook",
      timestamp: 200,
    });
    const c = makeFailure({
      eventType: "webhook.failed",
      webhookId: "https://b.com/hook",
      timestamp: 300,
    });

    store.record(a);
    store.record(b);
    store.record(c);

    const result = store.list({
      eventType: "webhook.failed",
      webhookId: "https://a.com/hook",
      since: 50,
    });

    expect(result).toEqual([a]);
  });

  it("cap evicts the oldest record when 1000 is exceeded — newest record is retained", () => {
    const store = new MemoryDeadLetterStore();
    const records: FailureRecord[] = [];

    for (let i = 0; i < 1001; i++) {
      const r = makeFailure({ timestamp: i, reason: `Error ${i}` });
      records.push(r);
      store.record(r);
    }

    const all = store.list();
    expect(all).toHaveLength(1000);
    // The oldest (timestamp 0) should have been evicted
    expect(all[0]?.timestamp).toBe(1);
    // The newest (timestamp 1000) should be retained
    expect(all[all.length - 1]?.timestamp).toBe(1000);
  });

  it("cap still works — records at exactly cap are all retained", () => {
    const store = new MemoryDeadLetterStore();

    for (let i = 0; i < 1000; i++) {
      store.record(makeFailure({ timestamp: i }));
    }

    expect(store.list()).toHaveLength(1000);
  });
});

describe("DeadLetterStore auto-recording in WebhookDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("webhook.failed automatically records to a configured store", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    new WebhookDelivery(
      watcher,
      {
        url: "https://example.com/webhooks",
        secret: "top-secret",
        retries: 1,
      },
      store,
    );

    watcher.emit("*", deliveryEvent);
    await vi.runAllTimersAsync();

    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.eventType).toBe("webhook.failed");
    expect(entries[0]?.webhookId).toBe("https://example.com/webhooks");
    expect(entries[0]?.reason).toMatch(/network error/);
    expect(entries[0]?.attemptCount).toBe(1);
  });

  it("webhook.dropped automatically records to a configured store", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const store: DeadLetterStore = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    new WebhookDelivery(
      watcher,
      {
        url: "https://example.com/hook",
        secret: "top-secret",
        retries: 3,
        maxConcurrentRetries: 1,
      },
      store,
    );

    const event1 = { ...deliveryEvent, raw: { id: "evt_1" } };
    const event2 = { ...deliveryEvent, raw: { id: "evt_2" } };

    watcher.emit("*", event1);
    watcher.emit("*", event2);
    await flushAsyncWork();

    // event2's retry should trigger dropped for event1's retry
    // At least one dropped event should be recorded
    const dropped = store.list({ eventType: "webhook.dropped" });
    expect(dropped.length).toBeGreaterThanOrEqual(1);
    expect(dropped[0]?.eventType).toBe("webhook.dropped");
    expect(dropped[0]?.reason).toBe("retry_cap_exceeded");
    expect(dropped[0]?.attemptCount).toBe(0);
  });

  it("no store configured — events emit normally with no error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);

    new WebhookDelivery(watcher, {
      url: "https://example.com/webhooks",
      secret: "top-secret",
      retries: 1,
    });

    watcher.emit("*", deliveryEvent);
    await vi.runAllTimersAsync();

    expect(failedHandler).toHaveBeenCalledTimes(1);
  });
});
