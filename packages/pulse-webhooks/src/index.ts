import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital-stellar/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import { exponentialJittered } from "./backoff.js";
import type { BackoffStrategy } from "./backoff.js";
import { DeadLetterStore } from "./MemoryDeadLetterStore.js";
import { InMemoryRetryQueue } from "./adapters/InMemoryRetryQueue.js";
import type { RetryQueue, RetryRecord } from "./RetryQueue.js";
import { DEFAULT_CLOCK_SKEW_MS, DEFAULT_MAX_AGE_MS } from "./types.js";
import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";

export { exponentialJittered, linear, cappedExponential, constant } from "./backoff.js";
export type { BackoffStrategy } from "./backoff.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export { DeadLetterStore } from "./MemoryDeadLetterStore.js";
export { NOOP_WEBHOOK_METRICS, CountingWebhookMetrics } from "./metrics.js";
export { PostgresDeadLetterStore } from "./PostgresDeadLetterStore.js";
export { RedisRetryQueue } from "./RedisRetryQueue.js";
export type {
  DeadLetterEntry,
  DeadLetterFilter as MemoryDeadLetterFilter,
  DeliveryHealth,
} from "./MemoryDeadLetterStore.js";
export type {
  DeadLetterFilter,
  DeadLetterInput,
  DeadLetterRecord,
  PgLike,
} from "./PostgresDeadLetterStore.js";
export type { RedisLike, RedisRetryQueueOptions } from "./RedisRetryQueue.js";
export type { RetryQueue, RetryRecord } from "./RetryQueue.js";
export type {
  Span,
  Tracer,
  VerifierSignatureVersion,
  VerifyWebhookOptions,
  WebhookConfig,
  WebhookAttemptStatus,
  WebhookMetrics,
  WebhookTerminalOutcome,
} from "./types.js";

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
  /** ID of the dead-letter store entry recorded for this terminal failure. */
  dlqId: string;
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

type ResolvedWebhookConfig = Omit<
  Required<WebhookConfig>,
  "url" | "tracer" | "urlValidator" | "metrics" | "backoff"
> & {
  urls: string[];
  backoff: BackoffStrategy;
  tracer?: Tracer;
  urlValidator?: WebhookConfig["urlValidator"];
  metrics?: WebhookConfig["metrics"];
};

export class WebhookDelivery {
  private readonly config: ResolvedWebhookConfig;
  private readonly watcher: Watcher;
  private readonly retryQueue: RetryQueue;
  private readonly dlq: DeadLetterStore;
  private queueProcessingInterval: ReturnType<typeof setInterval> | null = null;
  private processingRetries = false;
  private retrySequence = 0;

  constructor(watcher: Watcher, config: WebhookConfig, dlq?: DeadLetterStore) {
    this.watcher = watcher;
    this.dlq = dlq ?? new DeadLetterStore();
    this.retryQueue = new InMemoryRetryQueue();
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10_000,
      maxConcurrentRetries: 100,
      random: Math.random,
      backoff: exponentialJittered,
      ...config,
      tracer: config.tracer,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(1, Math.floor(this.config.maxConcurrentRetries));

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

  private async deliverToUrl(event: NormalizedEvent, url: string, attempt = 1): Promise<void> {
    if (this.watcher.stopped) return;

    let customValidationError: string | null = null;
    try {
      customValidationError = this.config.urlValidator ? await this.config.urlValidator(url) : null;
    } catch (err) {
      if (!this.watcher.stopped) {
        this.emitFailure(event, url, this.getErrorMessage(err), attempt);
      }
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
    const abortTimer = setTimeout(() => controller.abort(), this.config.deliveryTimeoutMs);
    const span = this.startSpan(event, url, attempt);
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

      const successMs = Date.now() - startMs;
      span?.setAttribute("webhook.status", res.status);
      span?.setAttribute("webhook.latency_ms", successMs);
      this.config.metrics?.recordAttempt(url, attempt, successMs, "success");
      this.config.metrics?.recordTerminal(url, "success");
      this.dlq.recordSuccess(url);
    } catch (err) {
      const failureMs = Date.now() - startMs;
      const errorMessage = this.getErrorMessage(err);

      span?.setAttribute("webhook.latency_ms", failureMs);
      span?.setAttribute("webhook.error", errorMessage);

      if (this.watcher.stopped) return;

      this.config.metrics?.recordAttempt(url, attempt, failureMs, "failure");
      this.dlq.recordFailure(url);

      if (attempt < this.config.retries) {
        await this.scheduleRetry(event, url, attempt + 1);
      } else {
        this.emitFailure(event, url, errorMessage, attempt);
      }
    } finally {
      clearTimeout(abortTimer);
      span?.end();
    }
  }

  private async scheduleRetry(
    event: NormalizedEvent,
    url: string,
    nextAttempt: number,
  ): Promise<void> {
    const delayMs = Math.max(0, Math.floor(this.config.backoff(nextAttempt - 1, this.config.random)));
    const nowMs = Date.now();
    const record: RetryRecord = {
      id: this.createRetryId(event, url, nextAttempt),
      event,
      url,
      attempt: nextAttempt,
      nextRetryAt: nowMs + delayMs,
      createdAt: nowMs,
    };

    if ((await this.retryQueue.size()) >= this.config.maxConcurrentRetries) {
      const evicted = await this.retryQueue.evictNewest();
      if (evicted) {
        this.emitDropped(evicted.event, evicted.url);
      } else {
        this.emitDropped(event, url);
        return;
      }
    }

    await this.retryQueue.enqueue(record);
  }

  private async processRetryQueue(): Promise<void> {
    if (this.watcher.stopped || this.processingRetries) return;

    this.processingRetries = true;
    try {
      let record: RetryRecord | null;
      while ((record = await this.retryQueue.dequeue()) !== null) {
        try {
          await this.deliverToUrl(record.event, record.url, record.attempt);
        } finally {
          await this.retryQueue.ack(record.id);
        }
      }
    } finally {
      this.processingRetries = false;
    }
  }

  private async getQueueSize(): Promise<number> {
    return this.retryQueue.size();
  }

  private stop(): void {
    if (this.queueProcessingInterval !== null) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }

    void this.retryQueue.clear();
  }

  private clearRetryTimers(): void {
    void this.stop();
  }

  private emitDropped(event: NormalizedEvent, url: string): void {
    this.config.metrics?.recordTerminal(url, "dropped");
    this.dlq.add(url, event, "retry_cap_exceeded", 0);
    this.watcher.emit("webhook.dropped", {
      ...event,
      raw: {
        reason: "retry_cap_exceeded",
        url,
        maxConcurrentRetries: this.config.maxConcurrentRetries,
        originalEvent: event,
      } satisfies WebhookDroppedRaw,
    } as unknown as NormalizedEvent);
  }

  private emitFailure(
    event: NormalizedEvent,
    url: string,
    errorMessage: string,
    attempt: number,
  ): void {
    const dlqId = this.dlq.add(url, event, errorMessage, attempt);
    this.config.metrics?.recordTerminal(url, "failure");
    this.watcher.emit("webhook.failed", {
      ...event,
      raw: {
        error: errorMessage,
        url,
        attempts: attempt,
        originalEvent: event,
        dlqId,
      } satisfies WebhookFailureRaw,
    } as unknown as NormalizedEvent);
  }

  private startSpan(event: NormalizedEvent, url: string, attempt: number) {
    const parentTraceId = this.extractTraceId(event);
    const attrs: Record<string, string | number | boolean> = {
      "webhook.url": url,
      "webhook.attempt": attempt,
    };

    if (parentTraceId !== undefined) {
      attrs["webhook.parent_trace_id"] = parentTraceId;
    }

    return this.config.tracer?.startSpan("webhook.delivery", attrs);
  }

  private extractTraceId(event: NormalizedEvent): string | undefined {
    const raw = event.raw;
    if (
      raw !== null &&
      typeof raw === "object" &&
      "traceId" in raw &&
      typeof (raw as Record<string, unknown>).traceId === "string"
    ) {
      return (raw as Record<string, string>).traceId;
    }
    return undefined;
  }

  private createRetryId(event: NormalizedEvent, url: string, attempt: number): string {
    const raw = event.raw;
    const rawRecord = raw as unknown as Record<string, unknown>;
    const eventId =
      raw !== null &&
      typeof raw === "object" &&
      "id" in raw &&
      (typeof rawRecord.id === "string" || typeof rawRecord.id === "number")
        ? String(rawRecord.id)
        : `${event.type}-${event.timestamp}-${++this.retrySequence}`;

    return `${eventId}:${url}:${attempt}`;
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.name === "AbortError") {
      return `Delivery timed out after ${this.config.deliveryTimeoutMs}ms`;
    }

    return err instanceof Error ? err.message : "Unknown error";
  }

  private sign(payload: string, timestamp: string): string {
    return createHmac("sha256", this.config.secret).update(`${timestamp}.${payload}`).digest("hex");
  }
}

export function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): NormalizedEvent | null {
  if (!verifyWebhookRaw(payload, signature, secret, timestamp, options)) {
    return null;
  }

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
 * Use when routing the raw body to another consumer to avoid parse overhead.
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

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
