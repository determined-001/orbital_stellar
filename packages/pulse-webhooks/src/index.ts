import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";
import { MemoryRetryQueue } from "./RetryQueue.js";

import type { VerifyWebhookOptions, WebhookConfig, RetryRecord, RetryQueue } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
export { verifyWebhookEdge } from "./edge.js";
export { PostgresRetryQueue } from "./PostgresRetryQueue.js";
export { MemoryRetryQueue } from "./RetryQueue.js";
export type { PgLike, PostgresRetryQueueOptions } from "./PostgresRetryQueue.js";
export type { VerifyWebhookOptions, WebhookConfig, RetryRecord, RetryQueue } from "./types.js";

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url" | "urlValidator" | "retryQueue"> & {
  urls: string[];
  urlValidator?: WebhookConfig["urlValidator"];
  retryQueue?: WebhookConfig["retryQueue"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private retryQueue: RetryQueue;
  // Map of record ID -> active timer
  private retryTimers: Map<string, { timer: ReturnType<typeof setTimeout>; record: RetryRecord }> = new Map();

  constructor(watcher: Watcher, config: WebhookConfig) {
    this.watcher = watcher;
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      random: Math.random,
      ...config,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(1, this.config.maxConcurrentRetries);
    this.retryQueue = config.retryQueue || new MemoryRetryQueue();

    this.watcher.addStopHandler(() => {
      this.clearRetryTimers();
    });

    this.watcher.on("*", (event: NormalizedEvent | WatcherNotification) => {
      if ("raw" in event) {
        for (const url of this.config.urls) {
          void this.deliverToUrl(event, url);
        }
      }
    });
  }

  private async deliverToUrl(
    event: NormalizedEvent,
    url: string,
    attempt = 1,
  ): Promise<void> {
    if (this.watcher.stopped) return;

    let customValidationError: string | null = null;
    try {
      customValidationError = this.config.urlValidator
        ? await this.config.urlValidator(url)
        : null;
    } catch (err) {
      if (this.watcher.stopped) return;

      this.emitFailure(event, url, this.getErrorMessage(err), attempt);
      return;
    }

    if (this.watcher.stopped) return;

    if (customValidationError) {
      this.emitFailure(event, url, customValidationError, attempt);
      return;
    }

    const payload = JSON.stringify(event);
    const timestamp = Date.now().toString();
    const signature = this.sign(payload, timestamp);
    const controller = new AbortController();
    const timeoutMs = this.config.deliveryTimeoutMs;
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-orbital-signature": signature,
          "x-orbital-timestamp": timestamp,
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
        const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
        const delay = Math.floor(this.config.random() * exponentialDelay);
        const nextAttemptAt = Date.now() + delay;
        const id = Math.random().toString(36).slice(2);

        const record: RetryRecord = {
          id,
          url,
          event,
          attempt,
          nextAttemptAt,
        };

        if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
          const newestId = [...this.retryTimers.keys()].at(-1);
          if (newestId) {
            const active = this.retryTimers.get(newestId);
            if (active) {
              clearTimeout(active.timer);
              this.retryTimers.delete(newestId);
              void this.retryQueue.evictNewest();
              
              this.watcher.emit("webhook.dropped", {
                ...active.record.event,
                raw: {
                  reason: "retry_cap_exceeded",
                  url: active.record.url,
                  maxConcurrentRetries: this.config.maxConcurrentRetries,
                  originalEvent: active.record.event,
                },
              } as unknown as NormalizedEvent);
            }
          }
        }

        void this.retryQueue.enqueue(record);

        const timer = setTimeout(async () => {
          this.retryTimers.delete(id);
          const dequeued = await this.retryQueue.dequeue();
          if (dequeued) {
            void this.deliverToUrl(dequeued.event, dequeued.url, dequeued.attempt + 1);
          }
        }, delay);

        this.retryTimers.set(id, { timer, record });
      } else {
        this.emitFailure(event, url, errorMessage, attempt);
      }
    } finally {
      clearTimeout(abortTimer);
    }
  }

  private emitFailure(
    event: NormalizedEvent,
    url: string,
    errorMessage: string,
    attempt: number,
  ): void {
    this.watcher.emit("webhook.failed", {
      ...event,
      raw: {
        error: errorMessage,
        url,
        attempts: attempt,
        originalEvent: event,
      },
    } as unknown as NormalizedEvent);
  }

  private clearRetryTimers(): void {
    for (const item of this.retryTimers.values()) {
      clearTimeout(item.timer);
    }
    this.retryTimers.clear();
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.name === "AbortError") {
      return `Delivery timed out after ${this.config.deliveryTimeoutMs}ms`;
    }

    return err instanceof Error ? err.message : "Unknown error";
  }

  private sign(payload: string, timestamp: string): string {
    const signedPayload = `${timestamp}.${payload}`;

    return createHmac("sha256", this.config.secret)
      .update(signedPayload)
      .digest("hex");
  }
}

export function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): NormalizedEvent | null {
  if (!/^\d+$/.test(timestamp)) return null;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return null;

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  if (timestampMs > nowMs + clockSkewMs) return null;
  if (timestampMs < nowMs - maxAgeMs - clockSkewMs) return null;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
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
