import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital/pulse-core";
import { DeadLetterStore, WebhookDelivery } from "../src/index.js";

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
  await Promise.resolve();
}

describe("DeadLetterStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures webhook.failed notifications emitted by WebhookDelivery", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher);
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 1, // fail immediately, no retry scheduling
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(dlq.size).toBe(1);
    const [record] = dlq.list();
    expect(record.url).toBe("https://example.com/hook");
    expect(record.error).toBe("network down");
    expect(record.replayCount).toBe(0);
    expect(record.originalEvent).toMatchObject({ raw: { id: "evt_1" } });
  });

  it("replays a failed event and delivers it successfully when downstream is healthy", async () => {
    // First call fails (downstream outage), second call (the replay) succeeds.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 outage"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher);
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 1,
    });

    // Initial delivery fails -> dead-lettered.
    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();
    expect(dlq.size).toBe(1);
    const { failureId } = dlq.list()[0];

    // Outage fixed: operator replays.
    const enqueued = dlq.replay(failureId);
    await flushAsyncWork();

    expect(enqueued).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The replayed POST carried the original event body verbatim.
    const secondCallBody = fetchMock.mock.calls[1][1].body;
    expect(JSON.parse(secondCallBody)).toMatchObject({ raw: { id: "evt_1" } });
    // No new failure was recorded for the successful replay.
    expect(dlq.get(failureId)?.replayCount).toBe(1);
  });

  it("tracks replay attempts and refuses after maxReplays to prevent infinite loops", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("still broken"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher, { maxReplays: 2 });
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 1,
    });

    const exhaustedHandler = vi.fn();
    watcher.on("webhook.replay_exhausted", exhaustedHandler);

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();
    const { failureId } = dlq.list()[0];

    // We seed the store from the FIRST failure only. Subsequent failures from
    // replays append new records, so target the original failureId throughout.
    expect(dlq.replay(failureId)).toBe(true); // replayCount 1
    await flushAsyncWork();
    expect(dlq.replay(failureId)).toBe(true); // replayCount 2 (== cap)
    await flushAsyncWork();
    expect(dlq.replay(failureId)).toBe(false); // refused

    expect(dlq.get(failureId)?.replayCount).toBe(2);
    expect(exhaustedHandler).toHaveBeenCalledTimes(1);
    expect(exhaustedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        raw: expect.objectContaining({
          reason: "replay_cap_exceeded",
          failureId,
          maxReplays: 2,
        }),
      }),
    );
  });

  it("throws when replaying an unknown failureId", () => {
    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher);
    expect(() => dlq.replay("dlq_nope")).toThrow(/No dead-letter record/);
  });

  it("throws when replaying after the watcher has stopped", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher);
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "s",
      retries: 1,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();
    const { failureId } = dlq.list()[0];

    watcher.stop();
    expect(() => dlq.replay(failureId)).toThrow(/watcher has stopped/);
  });

  it("delete() removes a record and stops capturing after close()", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const dlq = new DeadLetterStore(watcher);
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "s",
      retries: 1,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();
    const { failureId } = dlq.list()[0];
    expect(dlq.delete(failureId)).toBe(true);
    expect(dlq.size).toBe(0);

    dlq.close();
    watcher.emit("*", { ...deliveryEvent, raw: { id: "evt_2" } });
    await flushAsyncWork();
    expect(dlq.size).toBe(0); // no longer capturing
  });
});
