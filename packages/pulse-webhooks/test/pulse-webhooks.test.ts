import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

import { Watcher } from "@orbital/pulse-core";
import { verifyWebhook, WebhookDelivery } from "../src/index.js";

const deliveryEvent = {
    type: "payment.received",
    to: "GDEST",
    from: "GSRC",
    amount: "10",
    asset: "XLM",
    timestamp: "2026-04-26T12:00:00.000Z",
    raw: { id: "evt_1" },
} as const;

async function flushAsyncWork (): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function signWebhookPayload (secret: string, payload: string, timestamp: string): string {
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
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "https://staging.example.com/webhooks/stellar",
            expect.objectContaining({
                method: "POST",
                body: payload,
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            "https://audit.example.com/webhooks/stellar",
            expect.objectContaining({
                method: "POST",
                body: payload,
            })
        );
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
            expect.objectContaining({ method: "POST" })
        );
        expect(fetchMock).toHaveBeenCalledWith(
            successfulUrl,
            expect.objectContaining({ method: "POST" })
        );
        expect(failedHandler).toHaveBeenCalledTimes(1);
        expect(failedHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                raw: expect.objectContaining({
                    url: failedUrl,
                    attempts: 1,
                    originalEvent: deliveryEvent,
                }),
            })
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
            })
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

        const allCalls = setTimeoutSpy.mock.calls.filter((call: any[]) => call[1] !== 10000);
        expect(allCalls.length).toBe(1);

        const attempt1Delay = allCalls[0][1] as number;
        expect(attempt1Delay).toBeGreaterThanOrEqual(0);
        expect(attempt1Delay).toBeLessThan(1000);

        vi.advanceTimersByTime(attempt1Delay + 1);
        await flushAsyncWork();

        const allCallsAfterRetry = setTimeoutSpy.mock.calls.filter((call: any[]) => call[1] !== 10000);
        expect(allCallsAfterRetry.length).toBe(2);

        const attempt2Delay = allCallsAfterRetry[1][1] as number;
        expect(attempt2Delay).toBeGreaterThanOrEqual(0);
        expect(attempt2Delay).toBeLessThan(2000);
    });
});

describe("pulse-webhooks verifyWebhook", () => {
    it("returns parsed event when signature matches timestamped payload", () => {
        const payload = JSON.stringify(deliveryEvent);
        const timestamp = "1714176000000";
        const signature = signWebhookPayload("top-secret", payload, timestamp);

        const event = verifyWebhook(payload, signature, "top-secret", timestamp);

        expect(event).toEqual(deliveryEvent);
    });

    it("returns null when timestamp is missing or invalid", () => {
        const payload = JSON.stringify(deliveryEvent);
        const signature = signWebhookPayload("top-secret", payload, "1714176000000");

        expect(verifyWebhook(payload, signature, "top-secret", "")).toBeNull();
        expect(verifyWebhook(payload, signature, "top-secret", "not-a-number")).toBeNull();
    });

    it("returns null when signature does not match timestamped payload", () => {
        const payload = JSON.stringify(deliveryEvent);
        const timestamp = "1714176000000";
        const signature = signWebhookPayload("top-secret", payload, timestamp);

        expect(verifyWebhook(payload, signature, "wrong-secret", timestamp)).toBeNull();
        expect(verifyWebhook(`${payload}x`, signature, "top-secret", timestamp)).toBeNull();
        expect(verifyWebhook(payload, signature, "top-secret", "1714176000001")).toBeNull();
    });
});
