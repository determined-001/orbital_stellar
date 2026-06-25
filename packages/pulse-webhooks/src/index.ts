import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import type { VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
import type { RetryQueue, RetryRecord } from "./RetryQueue.js";
import { InMemoryRetryQueue } from "./adapters/InMemoryRetryQueue.js";
export { verifyWebhookEdge } from "./edge.js";
export type { VerifyWebhookOptions, WebhookConfig } from "./types.js";
export type { RetryQueue, RetryRecord } from "./RetryQueue.js";
import { DeadLetterStore } from "./MemoryDeadLetterStore.js";
import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
export { DeadLetterStore } from "./MemoryDeadLetterStore.js";
export { NOOP_WEBHOOK_METRICS, CountingWebhookMetrics } from "./metrics.js";
export type { WebhookMetrics } from "./types.js";
export { PostgresDeadLetterStore } from "./PostgresDeadLetterStore.js";
export { RedisRetryQueue } from "./RedisRetryQueue.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export type { DeadLetterEntry, DeadLetterFilter as MemoryDeadLetterFilter } from "./MemoryDeadLetterStore.js";
export type { DeadLetterFilter, DeadLetterInput, DeadLetterRecord, PgLike } from "./PostgresDeadLetterStore.js";
export type { RedisLike, RedisRetryQueueOptions } from "./RedisRetryQueue.js";
export type { RetryQueue, RetryRecord } from "./RetryQueue.js";
export type { Span, Tracer, VerifierSignatureVersion, VerifyWebhookOptions, WebhookConfig } from "./types.js";

/**
 * Payload for the `raw` field of a `webhook.failed` event.
 */
export type WebhookFailureRaw = {
  /** Summary of the error that caused delivery to fail. */
  error: string;
  /** The target URL that failed delivery. */
  url: string;
  /** Total number of attempts made before giving up. */
  attempts: number;
  /** The original event that we tried to deliver. */
  originalEvent: NormalizedEvent;
};

/**
 * Payload for the `raw` field of a `webhook.dropped` event.
 */
export type WebhookDroppedRaw = {
  /** The reason the webhook was dropped. Currently only `retry_cap_exceeded`. */
  reason: "retry_cap_exceeded";
  /** The target URL that was dropped. */
  url: string;
  /** The `maxConcurrentRetries` limit that was hit. */
  maxConcurrentRetries: number;
  /** The original event that was dropped. */
  originalEvent: NormalizedEvent;
};

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url" | "tracer" | "urlValidator"> & {
  urls: string[];
  tracer?: Tracer;
  urlValidator?: WebhookConfig["urlValidator"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private retryQueue: RetryQueue;
  private queueProcessingInterval: ReturnType<typeof setInterval> | null = null;
  private dlq: DeadLetterStore;
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
  private retryTimers: Map<ReturnType<typeof setTimeout>, { event: NormalizedEvent; url: string }> = new Map();

  constructor(watcher: Watcher, config: WebhookConfig) {
    this.watcher = watcher;
    this.dlq = dlq ?? new DeadLetterStore();
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      random: Math.random,
      ...config,
      tracer: config.tracer,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(1, this.config.maxConcurrentRetries);

    // Initialize retry queue (default to in-memory adapter)
    this.retryQueue = new InMemoryRetryQueue();

    // Start queue processing
    this.queueProcessingInterval = setInterval(() => {
      void this.processRetryQueue();
    }, 100);

    this.watcher.addStopHandler(() => {
      this.stop();
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

    const parentTraceId = this.extractTraceId(event);
    const spanAttrs: Record<string, string | number | boolean> = {
      "webhook.url": url,
      "webhook.attempt": attempt,
    };
    if (parentTraceId !== undefined) {
      spanAttrs["webhook.parent_trace_id"] = parentTraceId;
    }
    const span = this.config.tracer?.startSpan("webhook.delivery", spanAttrs);
    const startMs = Date.now();

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

      span?.setAttribute("webhook.status", res.status);
      span?.setAttribute("webhook.latency_ms", Date.now() - startMs);
    } catch (err) {
      span?.setAttribute("webhook.latency_ms", Date.now() - startMs);
      span?.setAttribute("webhook.error", this.getErrorMessage(err));

      if (this.watcher.stopped) return;

      const errorMessage = this.getErrorMessage(err);

      if (attempt < this.config.retries) {
        // Schedule retry using the queue with nextRetryAt timing
        const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
        const jitteredDelay = Math.floor(this.config.random() * exponentialDelay);
        const nextRetryAt = Date.now() + jitteredDelay;

        const record: RetryRecord = {
          id: `${event.id}-${url}-${attempt + 1}`,
          event,
          url,
          attempt: attempt + 1,
          nextRetryAt,
          createdAt: Date.now(),
        };

        try {
          // Check if we're at capacity; if so, emit dropped and don't enqueue
          if (
            (await this.getQueueSize()) >= this.config.maxConcurrentRetries
          ) {
            this.watcher.emit("webhook.dropped", {
              ...event,
              raw: {
                reason: "retry_cap_exceeded",
                url,
                maxConcurrentRetries: this.config.maxConcurrentRetries,
                originalEvent: event,
              },
            } as unknown as NormalizedEvent);
          } else {
            await this.retryQueue.enqueue(record);
          }
        } catch (queueErr) {
          // If queue operation fails, emit failed event
          this.watcher.emit("webhook.failed", {
            ...event,
            raw: {
              error: this.getErrorMessage(queueErr),
              url,
              attempts: attempt,
              originalEvent: event,
        // Enforce the retry cap — evict the newest pending retry when at limit.
        if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
          // Evict the newest (last-inserted) retry — it has waited the least, so dropping it wastes the least elapsed time.
          const newestTimer = [...this.retryTimers.keys()].at(-1)!;
          const newest = this.retryTimers.get(newestTimer)!;
          clearTimeout(newestTimer);
          this.retryTimers.delete(newestTimer);
          this.watcher.emit("webhook.dropped", {
            ...newest.event,
            raw: {
              reason: "retry_cap_exceeded",
              url: newest.url,
              maxConcurrentRetries: this.config.maxConcurrentRetries,
              originalEvent: newest.event,
            } satisfies WebhookDroppedRaw,
          } as unknown as NormalizedEvent);
        }
      } else {
        this.watcher.emit("webhook.failed", {
          ...event,
          raw: {
        // Add to dead letter store
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
        this.emitFailure(event, url, errorMessage, attempt);
      }
    } finally {
      clearTimeout(abortTimer);
      span?.end();
    }
  }

  private extractTraceId(event: NormalizedEvent): string | undefined {
    const raw = event.raw;
    if (raw !== null && typeof raw === "object" && "traceId" in raw && typeof (raw as Record<string, unknown>).traceId === "string") {
      return (raw as Record<string, string>).traceId;
    }
    return undefined;
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
      } satisfies WebhookFailureRaw,
    } as unknown as NormalizedEvent);
  }

  private async processRetryQueue(): Promise<void> {
    if (this.watcher.stopped) return;

    let record: RetryRecord | null;
    while ((record = await this.retryQueue.dequeue()) !== null) {
      // Deliver the retry, which will re-enqueue if needed
      void this.deliverToUrl(record.event, record.url, record.attempt);
    }
  }

  private async getQueueSize(): Promise<number> {
    return this.retryQueue.size();
    }
  }

  private stop(): void {
    // Stop the polling interval
    if (this.queueProcessingInterval !== null) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }

    // Clear the queue
    void this.retryQueue.clear();
  }

  private clearRetryTimers(): void {
    // Deprecated - kept for backward compatibility during migration
    // Queue clearing is now handled by stop()
    void this.stop();
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

  if (!verifyWebhookRaw(payload, signature, secret, timestamp)) {
    return null;
  }

  if (!verifyWebhookRaw(payload, signature, secret, timestamp, options)) return null;
  try {
    const evt = JSON.parse(payload) as NormalizedEvent;
    if (options.schema) {
      try {
        if (!options.schema(evt)) return null;
      } catch {
        return null;
      }
    }
    return evt;
  } catch {
    return null;
  }
}

/**
 * Verifies webhook signature without parsing JSON.
 * Use when routing the raw body to another consumer (e.g., a queue) to avoid the parse overhead.
 */
export function verifyWebhookRaw(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): boolean {
  if (!/^\d+$/.test(timestamp)) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return false;

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  if (timestampMs > nowMs + clockSkewMs) return false;
  if (timestampMs < nowMs - maxAgeMs - clockSkewMs) return false;

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
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
