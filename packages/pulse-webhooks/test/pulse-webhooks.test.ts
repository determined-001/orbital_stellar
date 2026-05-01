import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Watcher } from "@orbital/pulse-core";
import { WebhookDelivery } from "../src/index.js";

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
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal("fetch", fetchMock);

        const watcher = new Watcher("GABC");
        new WebhookDelivery(watcher, {
            url: [
                "https://prod.example.com/webhooks/stellar",
                "https://staging.example.com/webhooks/stellar",
                "https://audit.example.com/webhooks/stellar",
            ],
            secret: "top-secret",
        });

        watcher.emit("*", deliveryEvent);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "https://prod.example.com/webhooks/stellar",
            expect.objectContaining({ method: "POST", body: JSON.stringify(deliveryEvent) })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "https://staging.example.com/webhooks/stellar",
            expect.objectContaining({ method: "POST", body: JSON.stringify(deliveryEvent) })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            "https://audit.example.com/webhooks/stellar",
            expect.objectContaining({ method: "POST", body: JSON.stringify(deliveryEvent) })
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
});