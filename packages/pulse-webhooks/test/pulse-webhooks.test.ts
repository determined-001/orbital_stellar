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