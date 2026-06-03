import type {
  NormalizedEvent,
  Watcher,
  WatcherNotification,
} from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
import type { RetryRecord } from "./RetryQueue.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export { PostgresRetryQueue } from "./PostgresRetryQueue.js";
export { MemoryRetryQueue } from "./RetryQueue.js";
export { RedisRetryQueue } from "./RedisRetryQueue.js";
export type { PgLike, PostgresRetryQueueOptions } from "./PostgresRetryQueue.js";
export type { RedisLike, RedisRetryQueueOptions } from "./RedisRetryQueue.js";
export type { RetryRecord, RetryQueue } from "./RetryQueue.js";
export type {
  Span,
  Tracer,
  VerifierSignatureVersion,
  VerifyWebhookOptions,
  WebhookConfig,
} from "./types.js";

export interface DeadLetterEntry {
  id: string;
  url: string;
  event: NormalizedEvent;
  error: string;
  attempts: number;
  timestamp: number;
}

export interface DeadLetterFilter {
  url?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface DeadLetterHealth {
  healthy: boolean;
  lastSuccess?: number;
  lastFailure?: number;
  failureRate: number;
}

export class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private nextId: number = 0;
  private successTimestamps: Map<string, number> = new Map();

  add(
    url: string,
    event: NormalizedEvent,
    error: string,
    attempts: number,
  ): string {
    const id = `dlq_${this.nextId++}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timestamp = Date.now();

    this.entries.set(id, {
      id,
      url,
      event,
      error,
      attempts,
      timestamp,
    });

    return id;
  }

  list(filter: DeadLetterFilter = {}): DeadLetterEntry[] {
    let results = Array.from(this.entries.values());

    if (filter.url !== undefined) {
      results = results.filter((entry) => entry.url === filter.url);
    }

    if (filter.since !== undefined) {
      results = results.filter((entry) => entry.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter((entry) => entry.timestamp <= filter.until!);
    }

    results.sort((a, b) => a.timestamp - b.timestamp);

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  recordSuccess(url: string): void {
    this.successTimestamps.set(url, Date.now());
  }

  getHealth(url: string): DeadLetterHealth {
    const nowMs = Date.now();
    const oneHourAgoMs = nowMs - 60 * 60 * 1000;
    const fifteenMinutesAgoMs = nowMs - 15 * 60 * 1000;

    const recentFailures = this.list({
      url,
      since: oneHourAgoMs,
    });

    const lastSuccessMs = this.successTimestamps.get(url);

    const lastFailureMs =
      recentFailures.length > 0
        ? recentFailures[recentFailures.length - 1]!.timestamp
        : undefined;

    const failureRate =
      recentFailures.length === 0
        ? 0
        : recentFailures.length / (recentFailures.length + 1);

    const hasRecentSuccess =
      lastSuccessMs !== undefined && lastSuccessMs >= fifteenMinutesAgoMs;
    const healthy = failureRate < 0.05 && hasRecentSuccess;

    return {
      healthy,
      lastSuccess: lastSuccessMs,
      lastFailure: lastFailureMs,
      failureRate,
    };
  }
}

const globalDLQ = new DeadLetterStore();

export function deliveryHealth(url: string): DeadLetterHealth {
  return globalDLQ.getHealth(url);
}

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url"> & {
  urls: string[];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private dlq: DeadLetterStore;
  private retryTimers: Map<
    ReturnType<typeof setTimeout>,
    { event: NormalizedEvent; url: string }
  > = new Map();

  constructor(watcher: Watcher, config: WebhookConfig, dlq?: DeadLetterStore) {
    this.watcher = watcher;
    this.dlq = dlq ?? globalDLQ;
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      random: Math.random,
      ...config,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(
      1,
      this.config.maxConcurrentRetries,
    );

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

  getDeadLetterStore(): DeadLetterStore {
    return this.dlq;
  }

  private async deliverToUrl(
    event: NormalizedEvent,
    url: string,
    attempt = 1,
  ): Promise<void> {
    if (this.watcher.stopped) return;

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

      this.dlq.recordSuccess(url);
    } catch (err) {
      if (this.watcher.stopped) return;

      const errorMessage = this.getErrorMessage(err);

      if (attempt < this.config.retries) {
        const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
        const delay = Math.floor(this.config.random() * exponentialDelay);
        const nextRetryAt = Date.now() + delay;

        if (this.config.retryQueue) {
          const record: RetryRecord = {
            webhookId: url,
            payload: event,
            attemptCount: attempt,
            nextRetryAt,
            createdAt: Date.now(),
            url,
            event,
            attempt,
          };

          this.config.retryQueue.enqueue(record);
        } else {
          if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
            const newestTimer = [...this.retryTimers.keys()].at(-1)!;
            const newest = this.retryTimers.get(newestTimer)!;
            clearTimeout(newestTimer);
            this.retryTimers.delete(newestTimer);

            const dlqId = this.dlq.add(
              newest.url,
              newest.event,
              "Retry capacity exceeded, dropped from queue",
              attempt,
            );

            this.watcher.emit("webhook.dropped", {
              ...newest.event,
              raw: {
                dlqId,
                reason: "retry_cap_exceeded",
                url: newest.url,
                maxConcurrentRetries: this.config.maxConcurrentRetries,
                originalEvent: newest.event,
              },
            } as unknown as NormalizedEvent);
          }

          const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            void this.deliverToUrl(event, url, attempt + 1);
          }, delay);

          this.retryTimers.set(timer, { event, url });
        }
      } else {
        const dlqId = this.dlq.add(url, event, errorMessage, attempt);

        this.watcher.emit("webhook.failed", {
          ...event,
          raw: {
            dlqId,
            error: errorMessage,
            url,
            attempts: attempt,
            originalEvent: event,
          },
        } as unknown as NormalizedEvent);
      }
    } finally {
      clearTimeout(abortTimer);
    }
  }

  private clearRetryTimers(): void {
    for (const timer of this.retryTimers.keys()) {
      clearTimeout(timer);
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
): NormalizedEvent | null {
  if (!verifyWebhookRaw(payload, signature, secret, timestamp)) {
    return null;
  }

  try {
    return JSON.parse(payload) as NormalizedEvent;
  } catch {
    return null;
  }
}

export function verifyWebhookRaw(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
): boolean {
  if (!/^\d+$/.test(timestamp)) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
