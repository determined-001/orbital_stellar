import type {
  NormalizedEvent,
  Watcher,
  WatcherNotification,
} from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";
import { MemoryRetryQueue } from "./RetryQueue.js";

import type { Tracer, VerifyWebhookOptions, WebhookConfig, RetryRecord, RetryQueue } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export type { RetryQueue, RetryRecord } from "./RetryQueue.js";
export type {
  Span,
  Tracer,
  VerifierSignatureVersion,
  VerifyWebhookOptions,
  WebhookConfig,
} from "./types.js";
export { MemoryDeadLetterStore } from "./DeadLetterStore.js";
export type { FailureRecord } from "./DeadLetterStore.js";

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

/**
 * Dead Letter Queue for failed webhook deliveries.
 * Stores failed webhooks keyed by unique failure ID.
 * Supports querying by URL, time window, and limit.
 *
 * For best query performance, create indexes on:
 * - `url` (for URL-first queries)
 * - `timestamp` (for time-window queries)
 * - Composite index on `(url, timestamp)` (for combined filters)
 */
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

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url" | "urlValidator" | "retryQueue" | "deadLetterStore"> & {
  urls: string[];
  urlValidator?: WebhookConfig["urlValidator"];
  retryQueue?: WebhookConfig["retryQueue"];
  deadLetterStore?: WebhookConfig["deadLetterStore"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private dlq: DeadLetterStore;
  private retryQueue: RetryQueue;
  private retryTimers: Map<
    ReturnType<typeof setTimeout>,
    { event: NormalizedEvent; url: string }
  > = new Map();

  constructor(watcher: Watcher, config: WebhookConfig, dlq?: DeadLetterStore) {
    this.watcher = watcher;
    this.dlq = dlq ?? globalDLQ;
    this.retryQueue = config.retryQueue || new MemoryRetryQueue();
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

    if (config.deadLetterStore) {
      const customStore = config.deadLetterStore;

      this.watcher.on("webhook.failed", (ev: any) => {
        if (ev && ev.raw) {
          customStore.record({
            eventType: "webhook.failed",
            webhookId: ev.raw.url,
            payload: ev.raw.originalEvent,
            reason: ev.raw.error,
            timestamp: Date.now(),
            attemptCount: ev.raw.attempts,
          });
        }
      });

      this.watcher.on("webhook.dropped", (ev: any) => {
        if (ev && ev.raw) {
          customStore.record({
            eventType: "webhook.dropped",
            webhookId: ev.raw.url,
            payload: ev.raw.originalEvent,
            reason: ev.raw.reason,
            timestamp: Date.now(),
            attemptCount: ev.raw.maxConcurrentRetries ? ev.raw.maxConcurrentRetries : 1,
          });
        }
      });
    }

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

      this.dlq.recordSuccess(url);
    } catch (err) {
      if (this.watcher.stopped) return;

      const errorMessage = this.getErrorMessage(err);

      if (attempt < this.config.retries) {
        if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
          const newestTimer = [...this.retryTimers.keys()].at(-1)!;
          const newest = this.retryTimers.get(newestTimer)!;
          clearTimeout(newestTimer);
          this.retryTimers.delete(newestTimer);

          void this.retryQueue.evictNewest();

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

        void this.retryQueue.enqueue(record);

        const timer = setTimeout(async () => {
          this.retryTimers.delete(timer);
          const dequeued = await this.retryQueue.dequeue();
          if (dequeued) {
            void this.deliverToUrl(dequeued.event, dequeued.url, dequeued.attempt + 1);
          }
        }, delay);

        this.retryTimers.set(timer, { event, url });
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

  private emitFailure(
    event: NormalizedEvent,
    url: string,
    errorMessage: string,
    attempt: number,
  ): void {
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
