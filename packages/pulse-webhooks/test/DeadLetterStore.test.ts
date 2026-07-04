import { afterEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital-stellar/pulse-core";
import { MemoryDeadLetterStore, WebhookDelivery, configureDeadLetterStore } from "../src/index.js";

const deliveryEvent = {
  type: "payment.received",
  to: "GDEST",
  from: "GSRC",
  amount: "10",
  asset: "XLM",
  timestamp: "2026-04-26T12:00:00.000Z",
  raw: { id: "evt_1" },
} as const;

const hookUrl = "https://example.com/webhooks";

describe("DeadLetterStore", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records failures and returns an id", async () => {
    const store = new MemoryDeadLetterStore();
    const id = await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "HTTP 500",
      attempts: 3,
    });

    expect(id).toMatch(/^dlq_\d+_\d+_[a-z0-9]+$/);
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      url: hookUrl,
      error: "HTTP 500",
      attempts: 3,
      event: deliveryEvent,
    });
  });

  it("filters list results by url, since, until, and limit", async () => {
    vi.useFakeTimers();
    const store = new MemoryDeadLetterStore();
    const prodUrl = "https://prod.com/webhooks";
    const stagingUrl = "https://staging.com/webhooks";

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    await store.record({
      url: prodUrl,
      event: deliveryEvent,
      error: "Error 1",
      attempts: 1,
    });

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const middleId = await store.record({
      url: prodUrl,
      event: deliveryEvent,
      error: "Error 2",
      attempts: 2,
    });

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    await store.record({
      url: stagingUrl,
      event: deliveryEvent,
      error: "Error 3",
      attempts: 3,
    });

    const prodEntries = await store.list({ url: prodUrl });
    expect(prodEntries).toHaveLength(2);

    const sinceEntries = await store.list({
      since: new Date("2026-04-26T10:30:00Z").getTime(),
    });
    expect(sinceEntries.map((entry) => entry.id)).toEqual([middleId, sinceEntries[1]?.id]);

    const untilEntries = await store.list({
      until: new Date("2026-04-26T11:30:00Z").getTime(),
    });
    expect(untilEntries).toHaveLength(2);

    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("evicts oldest entries at the 1000-entry FIFO cap", async () => {
    const store = new MemoryDeadLetterStore({ maxEntries: 3 });

    const firstId = await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "first",
      attempts: 1,
    });
    await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "second",
      attempts: 1,
    });
    await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "third",
      attempts: 1,
    });
    await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "fourth",
      attempts: 1,
    });

    const entries = await store.list();
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.error)).toEqual(["second", "third", "fourth"]);
    expect(entries.some((entry) => entry.id === firstId)).toBe(false);
  });

  it("computes failureRate over a sliding window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));

    const store = new MemoryDeadLetterStore();
    store.recordSuccess(hookUrl);
    store.recordFailure(hookUrl);
    store.recordFailure(hookUrl);

    await expect(store.failureRate(hookUrl, 60 * 60 * 1000)).resolves.toBeCloseTo(66.67, 1);

    vi.advanceTimersByTime(60 * 60 * 1000);
    await expect(store.failureRate(hookUrl, 60 * 60 * 1000)).resolves.toBe(0);
  });

  it("replays a stored failure through the configured handler", async () => {
    const replay = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDeadLetterStore({ replay });
    const id = await store.record({
      url: hookUrl,
      event: deliveryEvent,
      error: "HTTP 500",
      attempts: 3,
    });

    await store.replay(id);

    expect(replay).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        url: hookUrl,
        event: deliveryEvent,
      }),
    );
    expect(store.get(id)?.replayedAt).toBeTypeOf("number");
  });

  it("records webhook.failed and webhook.dropped automatically via WebhookDelivery", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);

    const delivery = new WebhookDelivery(
      watcher,
      {
        url: hookUrl,
        secret: "top-secret",
        retries: 1,
      },
      store,
    );

    watcher.emit("*", deliveryEvent);
    await vi.runAllTimersAsync();

    const entries = await vi.waitFor(async () => {
      const result = await store.list();
      expect(result).toHaveLength(1);
      return result;
    });
    expect(entries[0]?.url).toBe(hookUrl);
    expect(entries[0]?.error).toMatch(/network error|timed out/);

    expect(failedHandler).toHaveBeenCalled();
    const failedCall = failedHandler.mock.calls[0][0];
    expect(failedCall.raw?.dlqId).toBe(entries[0]?.id);
    expect(delivery.getDeadLetterStore()).toBe(store);
  });

  it("re-enqueues replayed events through WebhookDelivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    const delivery = new WebhookDelivery(
      watcher,
      {
        url: hookUrl,
        secret: "top-secret",
        retries: 1,
      },
      store,
    );

    watcher.emit("*", deliveryEvent);
    await vi.runAllTimersAsync();

    const [failure] = await vi.waitFor(async () => {
      const result = await store.list();
      expect(result.length).toBeGreaterThan(0);
      return result;
    });
    expect(failure).toBeDefined();

    await delivery.replayFailure(failure!.id);
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.get(failure!.id)?.replayedAt).toBeTypeOf("number");
  });

  it("configureDeadLetterStore records terminal watcher events", async () => {
    const store = new MemoryDeadLetterStore();
    const watcher = new Watcher("GABC");
    configureDeadLetterStore(watcher, store);

    watcher.emit("webhook.failed", {
      type: "webhook.failed",
      timestamp: deliveryEvent.timestamp,
      raw: {
        error: "HTTP 500",
        url: hookUrl,
        attempts: 2,
        originalEvent: deliveryEvent,
      },
    });

    watcher.emit("webhook.dropped", {
      type: "webhook.dropped",
      timestamp: deliveryEvent.timestamp,
      raw: {
        reason: "retry_cap_exceeded",
        url: hookUrl,
        maxConcurrentRetries: 1,
        originalEvent: deliveryEvent,
      },
    });

    await vi.waitFor(async () => {
      expect(await store.list()).toHaveLength(2);
    });

    const entries = await store.list({ url: hookUrl });
    expect(entries.map((entry) => entry.error)).toEqual(["HTTP 500", "retry_cap_exceeded"]);
  });
});
