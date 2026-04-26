import { createHmac, timingSafeEqual } from "crypto";
import type { NormalizedEvent, Watcher } from "@orbital/pulse-core";
import type { WebhookConfig } from "./types.js";
export type { WebhookConfig } from "./types.js";

// --- WebhookDelivery ---

export class WebhookDelivery {
  private config: Required<WebhookConfig>;
  private watcher: Watcher;
  private retryTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(watcher: Watcher, config: WebhookConfig) {
    this.watcher = watcher;
    this.config = { retries: 3, deliveryTimeoutMs: 10000, ...config };

    this.watcher.addStopHandler(() => {
      this.clearRetryTimers();
    });

    this.watcher.on("*", (event) => {
      if ("raw" in event) this.deliver(event);
    });
  }

  private async deliver(event: NormalizedEvent, attempt = 1): Promise<void> {
    if (this.watcher.stopped) return;

    const payload = JSON.stringify(event);
    const signature = this.sign(payload);
    const controller = new AbortController();
    const timeoutMs = this.config.deliveryTimeoutMs;
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-orbital-signature": signature,
          "x-orbital-attempt": String(attempt),
        },
        body: payload,
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (this.watcher.stopped) return;

      const errorMessage = this.getErrorMessage(err);

      if (attempt < this.config.retries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer);
          void this.deliver(event, attempt + 1);
        }, delay);
        this.retryTimers.add(retryTimer);
      } else {
        this.watcher.emit("webhook.failed", {
          ...event,
          raw: {
            error: errorMessage,
            url: this.config.url,
            attempts: attempt,
            originalEvent: event,
          },
        } as NormalizedEvent);
      }
    } finally {
      clearTimeout(abortTimer);
    }
  }

  private clearRetryTimers(): void {
    for (const retryTimer of this.retryTimers) {
      clearTimeout(retryTimer);
    }
    this.retryTimers.clear();
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.name === "AbortError") {
      return `Delivery timed out after ${this.config.deliveryTimeoutMs}ms`;
    }

    return err instanceof Error ? err.message : "Unknown error";
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.config.secret)
      .update(payload)
      .digest("hex");
  }
}

// --- verifyWebhook ---

export function verifyWebhook(
  payload: string,
  signature: string,
  secret: string
): NormalizedEvent | null {
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return null;

  try {
    return JSON.parse(payload) as NormalizedEvent;
  } catch {
    return null;
  }
}
