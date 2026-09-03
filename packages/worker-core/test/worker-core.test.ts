import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock("dns/promises", () => ({ lookup: dnsLookupMock }));

import { WorkerNotifier } from "../src/index.js";

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  dnsLookupMock.mockReset();
  dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

function signWebhookPayload(secret: string, payload: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

describe("WorkerNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers worker.fired events through webhook path", async () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const secret = "test-secret";
    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret,
      },
    });

    notifier.notifyFired({
      workerId: "price-feed-1",
      window: "2026-04-27T00:00:00Z/PT1H",
      txHash: "abc123def456",
      ledger: 12345,
    });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/webhooks/workers");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.type).toBe("worker.fired");
    expect(body.workerId).toBe("price-feed-1");
    expect(body.window).toBe("2026-04-27T00:00:00Z/PT1H");
    expect(body.txHash).toBe("abc123def456");
    expect(body.ledger).toBe(12345);
    expect(body.timestamp).toBe("2026-04-27T00:00:00.000Z");

    // Verify HMAC signature
    const timestamp = options.headers["x-orbital-timestamp"];
    const signature = options.headers["x-orbital-signature"];
    const expectedSignature = signWebhookPayload(secret, options.body, timestamp);
    expect(signature).toBe(expectedSignature);
  });

  it("delivers worker.missed events through webhook path", async () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const secret = "test-secret";
    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret,
      },
    });

    const result = notifier.notifyMissed({
      workerId: "price-feed-1",
      window: "2026-04-27T00:00:00Z/PT1H",
      ledger: 12345,
      failures: [
        { error: "Connection timeout", timestamp: "2026-04-27T00:00:30.000Z", attempt: 1 },
        { error: "Service unavailable", timestamp: "2026-04-27T00:01:00.000Z", attempt: 2 },
      ],
    });

    expect(result).toBe(true);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe("worker.missed");
    expect(body.workerId).toBe("price-feed-1");
    expect(body.window).toBe("2026-04-27T00:00:00Z/PT1H");
    expect(body.failures).toHaveLength(2);
    expect(body.failures[0].error).toBe("Connection timeout");
    expect(body.failures[1].error).toBe("Service unavailable");
  });

  it("deduplicates miss notifications per (workerId, window) pair", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret: "test-secret",
      },
    });

    // First miss notification should be sent
    const result1 = notifier.notifyMissed({
      workerId: "price-feed-1",
      window: "2026-04-27T00:00:00Z/PT1H",
      failures: [{ error: "Timeout", timestamp: "2026-04-27T00:00:30.000Z", attempt: 1 }],
    });
    expect(result1).toBe(true);

    // Second miss for same (workerId, window) should be deduplicated
    const result2 = notifier.notifyMissed({
      workerId: "price-feed-1",
      window: "2026-04-27T00:00:00Z/PT1H",
      failures: [{ error: "Another error", timestamp: "2026-04-27T00:01:00.000Z", attempt: 2 }],
    });
    expect(result2).toBe(false);

    await flushAsyncWork();

    // Only one webhook should have been sent
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows miss notifications for different windows", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret: "test-secret",
      },
    });

    // First window miss
    const result1 = notifier.notifyMissed({
      workerId: "price-feed-1",
      window: "2026-04-27T00:00:00Z/PT1H",
      failures: [{ error: "Timeout", timestamp: "2026-04-27T00:00:30.000Z", attempt: 1 }],
    });
    expect(result1).toBe(true);

    // Second window miss (different window, same worker)
    const result2 = notifier.notifyMissed({
      workerId: "price-feed-1",
      window: "2026-04-27T01:00:00Z/PT1H",
      failures: [{ error: "Timeout", timestamp: "2026-04-27T01:00:30.000Z", attempt: 1 }],
    });
    expect(result2).toBe(true);

    await flushAsyncWork();

    // Both should have been sent
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hasMissBeenNotified tracks dedup state", async () => {
    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret: "test-secret",
      },
    });

    expect(notifier.hasMissBeenNotified("worker-1", "window-1")).toBe(false);

    notifier.notifyMissed({
      workerId: "worker-1",
      window: "window-1",
      failures: [{ error: "Error", timestamp: "2026-04-27T00:00:00.000Z", attempt: 1 }],
    });

    expect(notifier.hasMissBeenNotified("worker-1", "window-1")).toBe(true);
    expect(notifier.hasMissBeenNotified("worker-1", "window-2")).toBe(false);
    expect(notifier.hasMissBeenNotified("worker-2", "window-1")).toBe(false);
  });

  it("clearMissDedup resets dedup state", async () => {
    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret: "test-secret",
      },
    });

    notifier.notifyMissed({
      workerId: "worker-1",
      window: "window-1",
      failures: [{ error: "Error", timestamp: "2026-04-27T00:00:00.000Z", attempt: 1 }],
    });

    expect(notifier.hasMissBeenNotified("worker-1", "window-1")).toBe(true);

    notifier.clearMissDedup();

    expect(notifier.hasMissBeenNotified("worker-1", "window-1")).toBe(false);
  });

  it("stop() prevents further deliveries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new WorkerNotifier({
      webhook: {
        url: "https://api.example.com/webhooks/workers",
        secret: "test-secret",
      },
    });

    notifier.notifyFired({
      workerId: "worker-1",
      window: "window-1",
    });
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    notifier.stop();

    notifier.notifyFired({
      workerId: "worker-2",
      window: "window-2",
    });
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("delivers to multiple URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new WorkerNotifier({
      webhook: {
        url: [
          "https://api.example.com/webhooks/workers",
          "https://backup.example.com/webhooks/workers",
        ],
        secret: "test-secret",
      },
    });

    notifier.notifyFired({
      workerId: "worker-1",
      window: "window-1",
    });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/webhooks/workers",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://backup.example.com/webhooks/workers",
      expect.anything(),
    );
  });
});
