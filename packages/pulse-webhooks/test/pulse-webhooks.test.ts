import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital/pulse-core";
import type { WebhookMetrics } from "../src/index.js";
import {
  DeadLetterStore,
  verifyWebhook,
  verifyWebhookRaw,
  verifyWebhookEdge,
  verifyWebhookEdgeRaw,
  WebhookDelivery,
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

function signWebhookPayload(
  secret: string,
  payload: string,
  timestamp: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

describe("pulse-webhooks WebhookDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers each event to every configured URL", () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const secret = "top-secret";
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = Date.now().toString();
    const expectedSignature = signWebhookPayload(secret, payload, timestamp);

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: [
        "https://prod.example.com/webhooks/stellar",
        "https://staging.example.com/webhooks/stellar",
        "https://audit.example.com/webhooks/stellar",
      ],
      secret,
    });

    watcher.emit("*", deliveryEvent);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://prod.example.com/webhooks/stellar",
      expect.objectContaining({
        method: "POST",
        body: payload,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-orbital-attempt": "1",
          "x-orbital-timestamp": timestamp,
          "x-orbital-signature": expectedSignature,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://staging.example.com/webhooks/stellar",
      expect.objectContaining({
        method: "POST",
        body: payload,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://audit.example.com/webhooks/stellar",
      expect.objectContaining({
        method: "POST",
        body: payload,
      }),
    );
  });

  it("records each webhook attempt and terminal success outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const metrics: WebhookMetrics = {
      recordAttempt: vi.fn(),
      recordTerminal: vi.fn(),
    };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://prod.example.com/webhooks/stellar",
      secret: "top-secret",
      metrics,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(metrics.recordAttempt).toHaveBeenCalledTimes(1);
    expect(metrics.recordAttempt).toHaveBeenCalledWith(
      "https://prod.example.com/webhooks/stellar",
      1,
      expect.any(Number),
      "success",
    );
    expect(metrics.recordTerminal).toHaveBeenCalledTimes(1);
    expect(metrics.recordTerminal).toHaveBeenCalledWith(
      "https://prod.example.com/webhooks/stellar",
      "success",
    );
  });

  it("records all attempts and terminal failure when final delivery fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const metrics: WebhookMetrics = {
      recordAttempt: vi.fn(),
      recordTerminal: vi.fn(),
    };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://prod.example.com/webhooks/stellar",
      secret: "top-secret",
      retries: 2,
      random: () => 0,
      metrics,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    vi.advanceTimersByTime(0);
    await flushAsyncWork();

    expect(metrics.recordAttempt).toHaveBeenCalledTimes(2);
    expect(metrics.recordAttempt).toHaveBeenNthCalledWith(
      1,
      "https://prod.example.com/webhooks/stellar",
      1,
      expect.any(Number),
      "failure",
    );
    expect(metrics.recordAttempt).toHaveBeenNthCalledWith(
      2,
      "https://prod.example.com/webhooks/stellar",
      2,
      expect.any(Number),
      "failure",
    );
    expect(metrics.recordTerminal).toHaveBeenCalledTimes(1);
    expect(metrics.recordTerminal).toHaveBeenCalledWith(
      "https://prod.example.com/webhooks/stellar",
      "failure",
    );
  });

  it("rejects URL when custom urlValidator blocks an otherwise allowed URL without retrying", async () => {
    const allowedUrl = "https://prod.example.com/webhooks/stellar";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);

    new WebhookDelivery(watcher, {
      url: allowedUrl,
      secret: "top-secret",
      urlValidator: async (url) =>
        url === allowedUrl ? "blocked by custom validator" : null,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(failedHandler).toHaveBeenCalledTimes(1);
    expect(failedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        raw: expect.objectContaining({
          url: allowedUrl,
          error: "blocked by custom validator",
          attempts: 1,
        }),
      }),
    );

    vi.advanceTimersByTime(10_000);
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(failedHandler).toHaveBeenCalledTimes(1);
  });

  it("keeps delivering to other URLs when one URL fails", async () => {
    const failedUrl = "https://prod.example.com/webhooks/stellar";
    const successfulUrl = "https://audit.example.com/webhooks/stellar";
    const fetchMock = vi.fn((url: string) => {
      if (url === failedUrl) {
        return Promise.resolve({ ok: false, status: 500 });
      }

      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);

    new WebhookDelivery(watcher, {
      url: [failedUrl, successfulUrl],
      secret: "top-secret",
      retries: 1,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      failedUrl,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      successfulUrl,
      expect.objectContaining({ method: "POST" }),
    );
    expect(failedHandler).toHaveBeenCalledTimes(1);
    expect(failedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        raw: expect.objectContaining({
          url: failedUrl,
          attempts: 1,
          originalEvent: deliveryEvent,
        }),
      }),
    );
  });

  it("emits webhook.dropped and evicts the newest retry when maxConcurrentRetries cap is reached", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const droppedHandler = vi.fn();
    watcher.on("webhook.dropped", droppedHandler);

    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 3,
      maxConcurrentRetries: 2,
    });

    const event1 = { ...deliveryEvent, raw: { id: "evt_1" } };
    const event2 = { ...deliveryEvent, raw: { id: "evt_2" } };
    const event3 = { ...deliveryEvent, raw: { id: "evt_3" } };

    watcher.emit("*", event1);
    watcher.emit("*", event2);
    watcher.emit("*", event3);
    await flushAsyncWork();

    // events 1 and 2 fill the cap; event 2 (newest) is evicted when event 3's retry is scheduled
    expect(droppedHandler).toHaveBeenCalledTimes(1);
    expect(droppedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        raw: expect.objectContaining({
          reason: "retry_cap_exceeded",
          url: "https://example.com/hook",
          maxConcurrentRetries: 2,
          originalEvent: expect.objectContaining({ raw: { id: "evt_2" } }),
        }),
      }),
    );
  });

  it("clamps maxConcurrentRetries to 1 when configured as 0 and does not crash", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    const droppedHandler = vi.fn();
    watcher.on("webhook.dropped", droppedHandler);

    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 3,
      maxConcurrentRetries: 0,
    });

    watcher.emit("*", { ...deliveryEvent, raw: { id: "evt_1" } });
    watcher.emit("*", { ...deliveryEvent, raw: { id: "evt_2" } });
    await flushAsyncWork();

    // cap is clamped to 1: event 1 fills it, event 2's retry evicts event 1
    expect(droppedHandler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels pending retries for all URLs when the watcher stops", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: [
        "https://prod.example.com/webhooks/stellar",
        "https://staging.example.com/webhooks/stellar",
      ],
      secret: "top-secret",
      retries: 3,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    watcher.stop();
    vi.advanceTimersByTime(10_000);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies full jitter to retry backoff using a seeded RNG", async () => {
    let seed = 12345;
    const seededRandom = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/webhooks/stellar",
      secret: "top-secret",
      retries: 3,
      random: seededRandom,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    const allCalls = setTimeoutSpy.mock.calls.filter(
      (call: any[]) => call[1] !== 10000,
    );
    expect(allCalls.length).toBe(1);

    const attempt1Delay = allCalls[0][1] as number;
    expect(attempt1Delay).toBeGreaterThanOrEqual(0);
    expect(attempt1Delay).toBeLessThan(1000);

    vi.advanceTimersByTime(attempt1Delay + 1);
    await flushAsyncWork();

    const allCallsAfterRetry = setTimeoutSpy.mock.calls.filter(
      (call: any[]) => call[1] !== 10000,
    );
    expect(allCallsAfterRetry.length).toBe(2);

    const attempt2Delay = allCallsAfterRetry[1][1] as number;
    expect(attempt2Delay).toBeGreaterThanOrEqual(0);
    expect(attempt2Delay).toBeLessThan(2000);
  });

  describe("backoff strategies", () => {
    it("uses exponentialJittered strategy (default) with deterministic RNG", async () => {
      const { exponentialJittered } = await import("../src/backoff.js");

      let rngValue = 0.5;
      const fixedRandom = () => rngValue;

      expect(exponentialJittered(1, fixedRandom)).toBe(500); // 2^0 * 1000 * 0.5 = 500
      expect(exponentialJittered(2, fixedRandom)).toBe(1000); // 2^1 * 1000 * 0.5 = 1000
      expect(exponentialJittered(3, fixedRandom)).toBe(2000); // 2^2 * 1000 * 0.5 = 2000
      expect(exponentialJittered(4, fixedRandom)).toBe(4000); // 2^3 * 1000 * 0.5 = 4000
    });

    it("uses linear strategy with deterministic RNG", async () => {
      const { linear } = await import("../src/backoff.js");

      let rngValue = 0.5;
      const fixedRandom = () => rngValue;

      expect(linear(1, fixedRandom)).toBe(500); // 1 * 1000 * 0.5 = 500
      expect(linear(2, fixedRandom)).toBe(1000); // 2 * 1000 * 0.5 = 1000
      expect(linear(3, fixedRandom)).toBe(1500); // 3 * 1000 * 0.5 = 1500
      expect(linear(4, fixedRandom)).toBe(2000); // 4 * 1000 * 0.5 = 2000
    });

    it("uses cappedExponential strategy with deterministic RNG", async () => {
      const { cappedExponential } = await import("../src/backoff.js");

      let rngValue = 0.5;
      const fixedRandom = () => rngValue;

      expect(cappedExponential(1, fixedRandom)).toBe(500); // min(2^0 * 1000, 30000) * 0.5 = 500
      expect(cappedExponential(2, fixedRandom)).toBe(1000); // min(2^1 * 1000, 30000) * 0.5 = 1000
      expect(cappedExponential(3, fixedRandom)).toBe(2000); // min(2^2 * 1000, 30000) * 0.5 = 2000
      expect(cappedExponential(4, fixedRandom)).toBe(4000); // min(2^3 * 1000, 30000) * 0.5 = 4000
      expect(cappedExponential(5, fixedRandom)).toBe(8000); // min(2^4 * 1000, 30000) * 0.5 = 8000
      expect(cappedExponential(6, fixedRandom)).toBe(15000); // min(2^5 * 1000, 30000) * 0.5 = 15000
      expect(cappedExponential(7, fixedRandom)).toBe(15000); // min(2^6 * 1000, 30000) * 0.5 = 15000 (capped)
    });

    it("uses constant strategy with deterministic RNG", async () => {
      const { constant } = await import("../src/backoff.js");

      let rngValue = 0.5;
      const fixedRandom = () => rngValue;

      expect(constant(1, fixedRandom)).toBe(500); // 1000 * 0.5 = 500
      expect(constant(2, fixedRandom)).toBe(500); // 1000 * 0.5 = 500
      expect(constant(3, fixedRandom)).toBe(500); // 1000 * 0.5 = 500
      expect(constant(4, fixedRandom)).toBe(500); // 1000 * 0.5 = 500
    });

    it("accepts custom backoff strategy in WebhookConfig", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);

      let rngValue = 0.75;
      const fixedRandom = () => rngValue;

      const customStrategy: (attempt: number, rng: () => number) => number = (
        attempt,
        rng,
      ) => {
        return Math.floor(rng() * 5000); // constant 5000ms max delay
      };

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const watcher = new Watcher("GABC");
      new WebhookDelivery(watcher, {
        url: "https://example.com/webhooks/stellar",
        secret: "top-secret",
        retries: 2,
        random: fixedRandom,
        backoff: customStrategy,
      });

      watcher.emit("*", deliveryEvent);
      await flushAsyncWork();

      const timeoutCalls = setTimeoutSpy.mock.calls.filter(
        (call: any[]) => call[1] !== 10000,
      );

      // Custom strategy should produce 5000 * 0.75 = 3750ms delay
      expect(timeoutCalls[0][1]).toBe(3750);
    });
  });
});

describe("pulse-webhooks WebhookDelivery tracer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits one span per successful delivery attempt with url, attempt, status, and latency", async () => {
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const span = { setAttribute: vi.fn(), end: vi.fn() };
    const tracer = { startSpan: vi.fn().mockReturnValue(span) };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      tracer,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(tracer.startSpan).toHaveBeenCalledTimes(1);
    expect(tracer.startSpan).toHaveBeenCalledWith("webhook.delivery", expect.objectContaining({
      "webhook.url": "https://example.com/hook",
      "webhook.attempt": 1,
    }));
    expect(span.setAttribute).toHaveBeenCalledWith("webhook.status", 200);
    expect(span.setAttribute).toHaveBeenCalledWith("webhook.latency_ms", expect.any(Number));
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("emits a span per attempt on retry, recording error on failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const span = { setAttribute: vi.fn(), end: vi.fn() };
    const tracer = { startSpan: vi.fn().mockReturnValue(span) };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      retries: 2,
      tracer,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    // attempt 1 span is started and ended
    expect(tracer.startSpan).toHaveBeenCalledTimes(1);
    expect(span.setAttribute).toHaveBeenCalledWith("webhook.error", "network down");
    expect(span.setAttribute).toHaveBeenCalledWith("webhook.latency_ms", expect.any(Number));
    expect(span.end).toHaveBeenCalledTimes(1);

    // advance to trigger retry (attempt 2)
    vi.advanceTimersByTime(2000);
    await flushAsyncWork();

    expect(tracer.startSpan).toHaveBeenCalledTimes(2);
    expect(tracer.startSpan).toHaveBeenNthCalledWith(2, "webhook.delivery", expect.objectContaining({
      "webhook.url": "https://example.com/hook",
      "webhook.attempt": 2,
    }));
    expect(span.end).toHaveBeenCalledTimes(2);
  });

  it("propagates parent trace id from event.raw when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const span = { setAttribute: vi.fn(), end: vi.fn() };
    const tracer = { startSpan: vi.fn().mockReturnValue(span) };

    const eventWithTrace = {
      ...deliveryEvent,
      raw: { id: "evt_1", traceId: "abc123" },
    };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      tracer,
    });

    watcher.emit("*", eventWithTrace);
    await flushAsyncWork();

    expect(tracer.startSpan).toHaveBeenCalledWith("webhook.delivery", expect.objectContaining({
      "webhook.parent_trace_id": "abc123",
    }));
  });

  it("does not include parent_trace_id when event.raw has no traceId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const span = { setAttribute: vi.fn(), end: vi.fn() };
    const tracer = { startSpan: vi.fn().mockReturnValue(span) };

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
      tracer,
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    const startSpanAttrs = tracer.startSpan.mock.calls[0][1] as Record<string, unknown>;
    expect(startSpanAttrs).not.toHaveProperty("webhook.parent_trace_id");
  });

  it("does not throw when no tracer is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const watcher = new Watcher("GABC");
    new WebhookDelivery(watcher, {
      url: "https://example.com/hook",
      secret: "top-secret",
    });

    watcher.emit("*", deliveryEvent);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pulse-webhooks verifyWebhook", () => {
  it("returns parsed event when signature matches timestamped payload", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("accepts explicit v1 version option", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      version: "v1",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("accepts v2 placeholder without changing v1 verification behavior", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      version: "v2",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("returns null when timestamp is missing or invalid", () => {
    const payload = JSON.stringify(deliveryEvent);
    const signature = signWebhookPayload(
      "top-secret",
      payload,
      "1714176000000",
    );

    expect(verifyWebhook(payload, signature, "top-secret", "")).toBeNull();
    expect(
      verifyWebhook(payload, signature, "top-secret", "not-a-number"),
    ).toBeNull();
  });

  it("returns null when signature does not match timestamped payload", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    expect(
      verifyWebhook(payload, signature, "wrong-secret", timestamp),
    ).toBeNull();
    expect(
      verifyWebhook(`${payload}x`, signature, "top-secret", timestamp),
    ).toBeNull();
    expect(
      verifyWebhook(payload, signature, "top-secret", "1714176000001"),
    ).toBeNull();
  });

  it("accepts timestamp within configured clock skew window", () => {
    const payload = JSON.stringify(deliveryEvent);
    const nowMs = 1_714_176_000_000;
    const timestamp = String(nowMs + 20_000);
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs,
      maxAgeMs: 60_000,
      clockSkewMs: 30_000,
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("rejects timestamp outside configured skew and maxAge window", () => {
    const payload = JSON.stringify(deliveryEvent);
    const nowMs = 1_714_176_000_000;
    const tooFarFutureTs = String(nowMs + 30_001);
    const tooOldTs = String(nowMs - 60_000 - 30_001);

    const futureSig = signWebhookPayload("top-secret", payload, tooFarFutureTs);
    const oldSig = signWebhookPayload("top-secret", payload, tooOldTs);

    expect(
      verifyWebhook(payload, futureSig, "top-secret", tooFarFutureTs, {
        nowMs,
        maxAgeMs: 60_000,
        clockSkewMs: 30_000,
      }),
    ).toBeNull();
    expect(
      verifyWebhook(payload, oldSig, "top-secret", tooOldTs, {
        nowMs,
        maxAgeMs: 60_000,
        clockSkewMs: 30_000,
      }),
    ).toBeNull();
  });

  it("returns null when schema validation fails", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: (evt) => evt.type === "payment.sent",
    });

    expect(event).toBeNull();
  });

  it("returns event when schema validation succeeds", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: (evt) => evt.type === "payment.received",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("returns null when schema validator throws", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = verifyWebhook(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: () => { throw new Error("validator error"); },
    });

    expect(event).toBeNull();
  });
});

describe("pulse-webhooks verifyWebhookEdge", () => {
  it("returns parsed event when signature matches timestamped payload", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(
      payload,
      signature,
      "top-secret",
      timestamp,
      { nowMs: Number(timestamp) },
    );

    expect(event).toEqual(deliveryEvent);
  });

  it("accepts explicit v1 version option", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      version: "v1",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("accepts v2 placeholder without changing v1 verification behavior", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      version: "v2",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("returns null when timestamp is missing or invalid", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const signature = signWebhookPayload(
      "top-secret",
      payload,
      "1714176000000",
    );

    expect(
      await verifyWebhookEdge(payload, signature, "top-secret", ""),
    ).toBeNull();
    expect(
      await verifyWebhookEdge(payload, signature, "top-secret", "not-a-number"),
    ).toBeNull();
  });

  it("returns null when signature does not match timestamped payload", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    expect(
      await verifyWebhookEdge(payload, signature, "wrong-secret", timestamp),
    ).toBeNull();
    expect(
      await verifyWebhookEdge(
        `${payload}x`,
        signature,
        "top-secret",
        timestamp,
      ),
    ).toBeNull();
    expect(
      await verifyWebhookEdge(
        payload,
        signature,
        "top-secret",
        "1714176000001",
      ),
    ).toBeNull();
  });

  it("accepts timestamp within configured clock skew window", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const nowMs = 1_714_176_000_000;
    const timestamp = String(nowMs + 20_000);
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(
      payload,
      signature,
      "top-secret",
      timestamp,
      {
        nowMs,
        maxAgeMs: 60_000,
        clockSkewMs: 30_000,
      },
    );

    expect(event).toEqual(deliveryEvent);
  });

  it("rejects timestamp outside configured skew and maxAge window", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const nowMs = 1_714_176_000_000;
    const tooFarFutureTs = String(nowMs + 30_001);
    const tooOldTs = String(nowMs - 60_000 - 30_001);

    const futureSig = signWebhookPayload("top-secret", payload, tooFarFutureTs);
    const oldSig = signWebhookPayload("top-secret", payload, tooOldTs);

    expect(
      await verifyWebhookEdge(
        payload,
        futureSig,
        "top-secret",
        tooFarFutureTs,
        {
          nowMs,
          maxAgeMs: 60_000,
          clockSkewMs: 30_000,
        },
      ),
    ).toBeNull();
    expect(
      await verifyWebhookEdge(payload, oldSig, "top-secret", tooOldTs, {
        nowMs,
        maxAgeMs: 60_000,
        clockSkewMs: 30_000,
      }),
    ).toBeNull();
  });

  it("returns null for malformed JSON payload", async () => {
    const payload = "{ invalid json }";
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    expect(
      await verifyWebhookEdge(payload, signature, "top-secret", timestamp),
    ).toBeNull();
  });

  it("returns null when schema validation fails", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: (evt) => evt.type === "payment.sent",
    });

    expect(event).toBeNull();
  });

  it("returns event when schema validation succeeds", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: (evt) => evt.type === "payment.received",
    });

    expect(event).toEqual(deliveryEvent);
  });

  it("returns null when schema validator throws", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const event = await verifyWebhookEdge(payload, signature, "top-secret", timestamp, {
      nowMs: Number(timestamp),
      schema: () => { throw new Error("validator error"); },
    });

    expect(event).toBeNull();
  });
});

describe("pulse-webhooks verifyWebhookRaw", () => {
  it("returns true when signature matches timestamped payload", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const result = verifyWebhookRaw(
      payload,
      signature,
      "top-secret",
      timestamp,
    );

    expect(result).toBe(true);
  });

  it("returns false when timestamp is missing or invalid", () => {
    const payload = JSON.stringify(deliveryEvent);
    const signature = signWebhookPayload(
      "top-secret",
      payload,
      "1714176000000",
    );

    expect(verifyWebhookRaw(payload, signature, "top-secret", "")).toBe(false);
    expect(
      verifyWebhookRaw(payload, signature, "top-secret", "not-a-number"),
    ).toBe(false);
  });

  it("returns false when signature does not match timestamped payload", () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    expect(
      verifyWebhookRaw(payload, signature, "wrong-secret", timestamp),
    ).toBe(false);
    expect(
      verifyWebhookRaw(`${payload}x`, signature, "top-secret", timestamp),
    ).toBe(false);
    expect(
      verifyWebhookRaw(payload, signature, "top-secret", "1714176000001"),
    ).toBe(false);
  });

  it("returns true for malformed JSON payload (raw variant skips JSON parse)", () => {
    const payload = "{ invalid json }";
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    // Raw variant should return true (signature is valid), ignoring JSON validity
    const result = verifyWebhookRaw(
      payload,
      signature,
      "top-secret",
      timestamp,
    );

    expect(result).toBe(true);
  });
});

describe("pulse-webhooks verifyWebhookEdgeRaw", () => {
  it("returns true when signature matches timestamped payload", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    const result = await verifyWebhookEdgeRaw(
      payload,
      signature,
      "top-secret",
      timestamp,
    );

    expect(result).toBe(true);
  });

  it("returns false when timestamp is missing or invalid", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const signature = signWebhookPayload(
      "top-secret",
      payload,
      "1714176000000",
    );

    expect(
      await verifyWebhookEdgeRaw(payload, signature, "top-secret", ""),
    ).toBe(false);
    expect(
      await verifyWebhookEdgeRaw(
        payload,
        signature,
        "top-secret",
        "not-a-number",
      ),
    ).toBe(false);
  });

  it("returns false when signature does not match timestamped payload", async () => {
    const payload = JSON.stringify(deliveryEvent);
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    expect(
      await verifyWebhookEdgeRaw(payload, signature, "wrong-secret", timestamp),
    ).toBe(false);
    expect(
      await verifyWebhookEdgeRaw(
        `${payload}x`,
        signature,
        "top-secret",
        timestamp,
      ),
    ).toBe(false);
    expect(
      await verifyWebhookEdgeRaw(
        payload,
        signature,
        "top-secret",
        "1714176000001",
      ),
    ).toBe(false);
  });

  it("returns true for malformed JSON payload (raw variant skips JSON parse)", async () => {
    const payload = "{ invalid json }";
    const timestamp = "1714176000000";
    const signature = signWebhookPayload("top-secret", payload, timestamp);

    // Raw variant should return true (signature is valid), ignoring JSON validity
    const result = await verifyWebhookEdgeRaw(
      payload,
      signature,
      "top-secret",
      timestamp,
    );

    expect(result).toBe(true);
  });
});

describe("pulse-webhooks DeadLetterStore", () => {
  it("adds and retrieves entries by ID", () => {
    const dlq = new DeadLetterStore();
    const id = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "HTTP 500",
      3,
    );

    expect(id).toMatch(/^dlq_\d+_\d+_[a-z0-9]+$/);

    const entry = dlq.get(id);
    expect(entry).toBeDefined();
    expect(entry?.url).toBe("https://example.com/webhooks");
    expect(entry?.error).toBe("HTTP 500");
    expect(entry?.attempts).toBe(3);
    expect(entry?.event).toEqual(deliveryEvent);
    expect(entry?.timestamp).toBeGreaterThan(0);
  });

  it("lists all entries without filters", () => {
    const dlq = new DeadLetterStore();
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );
    const id2 = dlq.add(
      "https://staging.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    const entries = dlq.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toContain(id1);
    expect(entries.map((e) => e.id)).toContain(id2);
  });

  it("filters entries by URL", () => {
    const dlq = new DeadLetterStore();
    const prodUrl = "https://prod.com/webhooks";
    const stagingUrl = "https://staging.com/webhooks";

    dlq.add(prodUrl, deliveryEvent, "Error 1", 1);
    dlq.add(stagingUrl, deliveryEvent, "Error 2", 2);
    dlq.add(prodUrl, deliveryEvent, "Error 3", 3);

    const prodEntries = dlq.list({ url: prodUrl });
    expect(prodEntries).toHaveLength(2);
    expect(prodEntries.every((e) => e.url === prodUrl)).toBe(true);

    const stagingEntries = dlq.list({ url: stagingUrl });
    expect(stagingEntries).toHaveLength(1);
    expect(stagingEntries[0]?.url).toBe(stagingUrl);
  });

  it("filters entries by time range (since)", () => {
    vi.useFakeTimers();
    const dlq = new DeadLetterStore();

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const id2 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    const id3 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 3",
      3,
    );

    const since = new Date("2026-04-26T10:30:00Z").getTime();
    const entries = dlq.list({ since });

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toContain(id2);
    expect(entries.map((e) => e.id)).toContain(id3);
    expect(entries.map((e) => e.id)).not.toContain(id1);

    vi.useRealTimers();
  });

  it("filters entries by time range (until)", () => {
    vi.useFakeTimers();
    const dlq = new DeadLetterStore();

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const id2 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    const id3 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 3",
      3,
    );

    const until = new Date("2026-04-26T11:30:00Z").getTime();
    const entries = dlq.list({ until });

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toContain(id1);
    expect(entries.map((e) => e.id)).toContain(id2);
    expect(entries.map((e) => e.id)).not.toContain(id3);

    vi.useRealTimers();
  });

  it("filters entries by time range (since and until)", () => {
    vi.useFakeTimers();
    const dlq = new DeadLetterStore();

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const id2 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    const id3 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 3",
      3,
    );

    const since = new Date("2026-04-26T10:30:00Z").getTime();
    const until = new Date("2026-04-26T11:30:00Z").getTime();
    const entries = dlq.list({ since, until });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(id2);

    vi.useRealTimers();
  });

  it("limits the number of results", () => {
    const dlq = new DeadLetterStore();

    for (let i = 0; i < 10; i++) {
      dlq.add("https://example.com/webhooks", deliveryEvent, `Error ${i}`, i);
    }

    const entries = dlq.list({ limit: 5 });
    expect(entries).toHaveLength(5);
  });

  it("combines multiple filters (URL, time range, and limit)", () => {
    vi.useFakeTimers();
    const dlq = new DeadLetterStore();
    const prodUrl = "https://prod.com/webhooks";
    const stagingUrl = "https://staging.com/webhooks";

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    dlq.add(prodUrl, deliveryEvent, "Error 1", 1);
    dlq.add(stagingUrl, deliveryEvent, "Error 2", 2);

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const id3 = dlq.add(prodUrl, deliveryEvent, "Error 3", 3);
    dlq.add(stagingUrl, deliveryEvent, "Error 4", 4);

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    const id5 = dlq.add(prodUrl, deliveryEvent, "Error 5", 5);
    dlq.add(stagingUrl, deliveryEvent, "Error 6", 6);

    const since = new Date("2026-04-26T10:30:00Z").getTime();
    const until = new Date("2026-04-26T12:30:00Z").getTime();

    const entries = dlq.list({
      url: prodUrl,
      since,
      until,
      limit: 5,
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toContain(id3);
    expect(entries.map((e) => e.id)).toContain(id5);

    vi.useRealTimers();
  });

  it("removes entries by ID", () => {
    const dlq = new DeadLetterStore();
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );
    const id2 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    expect(dlq.size()).toBe(2);

    const removed = dlq.remove(id1);
    expect(removed).toBe(true);
    expect(dlq.size()).toBe(1);
    expect(dlq.get(id1)).toBeUndefined();
    expect(dlq.get(id2)).toBeDefined();
  });

  it("clears all entries", () => {
    const dlq = new DeadLetterStore();
    dlq.add("https://example.com/webhooks", deliveryEvent, "Error 1", 1);
    dlq.add("https://example.com/webhooks", deliveryEvent, "Error 2", 2);

    expect(dlq.size()).toBe(2);
    dlq.clear();
    expect(dlq.size()).toBe(0);
    expect(dlq.list()).toHaveLength(0);
  });

  it("returns entries sorted by timestamp (oldest first)", () => {
    vi.useFakeTimers();
    const dlq = new DeadLetterStore();

    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
    const id3 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 3",
      3,
    );

    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const id1 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 1",
      1,
    );

    vi.setSystemTime(new Date("2026-04-26T11:00:00Z"));
    const id2 = dlq.add(
      "https://example.com/webhooks",
      deliveryEvent,
      "Error 2",
      2,
    );

    const entries = dlq.list();
    expect(entries.map((e) => e.id)).toEqual([id1, id2, id3]);

    vi.useRealTimers();
  });

  it("returns healthy when recent success and no failures", () => {
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));

    const dlqInstance = new DeadLetterStore();
    dlqInstance.recordSuccess("https://example.com/hook");

    const health = dlqInstance.getHealth("https://example.com/hook");

    expect(health.healthy).toBe(true);
    expect(health.failureRate).toBe(0);
    expect(health.lastSuccess).toBeDefined();
  });

  it("tracks failed deliveries in the store automatically", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const dlq = new DeadLetterStore();
    const watcher = new Watcher("GABC");
    const failedHandler = vi.fn();
    watcher.on("webhook.failed", failedHandler);

    const delivery = new WebhookDelivery(
      watcher,
      {
        url: "https://example.com/webhooks",
        secret: "top-secret",
        retries: 1,
      },
      dlq,
    );

    expect(delivery.getDeadLetterStore()).toBe(dlq);

    watcher.emit("*", deliveryEvent);
    await vi.runAllTimersAsync();

    expect(dlq.size()).toBeGreaterThan(0);
    const entries = dlq.list();
    expect(entries[0]?.url).toBe("https://example.com/webhooks");
    expect(entries[0]?.error).toMatch(/network error|timed out/);
    expect(entries[0]?.event).toEqual(deliveryEvent);

    expect(failedHandler).toHaveBeenCalled();
    const failedCall = failedHandler.mock.calls[0][0];
    expect(failedCall.raw?.dlqId).toBeDefined();
    expect(failedCall.raw?.dlqId).toBe(entries[0]?.id);

    vi.useRealTimers();
  });
});
