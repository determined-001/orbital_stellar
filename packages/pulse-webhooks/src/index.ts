import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital-stellar/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import type { VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
import { NOOP_WEBHOOK_METRICS, CountingWebhookMetrics } from "./metrics.js";
import { exponentialJittered } from "./backoff.js";
import { DeadLetterStore } from "./MemoryDeadLetterStore.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export type { VerifyWebhookOptions, WebhookConfig } from "./types.js";
export type { WebhookMetrics } from "./types.js";
export { NOOP_WEBHOOK_METRICS, CountingWebhookMetrics } from "./metrics.js";
export { RedisRetryQueue } from "./RedisRetryQueue.js";
export { DeadLetterStore } from "./MemoryDeadLetterStore.js";

type ResolvedWebhookConfig = Omit<
  Required<WebhookConfig>,
  "url" | "urlValidator" | "backoff" | "tracer"
> & {
  urls: string[];
  urlValidator?: WebhookConfig["urlValidator"];
  backoff?: WebhookConfig["backoff"];
  tracer?: WebhookConfig["tracer"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private deadLetterStore?: DeadLetterStore;
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
  private retryTimers: Map<ReturnType<typeof setTimeout>, { event: NormalizedEvent; url: string }> =
    new Map();

  constructor(watcher: Watcher, config: WebhookConfig, deadLetterStore?: DeadLetterStore) {
    this.watcher = watcher;
    this.deadLetterStore = deadLetterStore;
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      random: Math.random,
      metrics: NOOP_WEBHOOK_METRICS,
      ...config,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(1, this.config.maxConcurrentRetries);
    this.config.metrics = this.config.metrics ?? NOOP_WEBHOOK_METRICS;

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

  private async deliverToUrl(event: NormalizedEvent, url: string, attempt = 1): Promise<void> {
    if (this.watcher.stopped) return;

    let customValidationError: string | null = null;
    try {
      customValidationError = this.config.urlValidator ? await this.config.urlValidator(url) : null;
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
    const attemptStartedAt = Date.now();

    const parentTraceId =
      event.raw && typeof event.raw === "object" && "traceId" in event.raw
        ? (event.raw as { traceId: string }).traceId
        : undefined;
    const span = this.config.tracer?.startSpan("webhook.delivery", {
      "webhook.url": url,
      "webhook.attempt": attempt,
      ...(parentTraceId ? { "webhook.parent_trace_id": parentTraceId } : {}),
    });

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

      const durationMs = Date.now() - attemptStartedAt;
      this.config.metrics.recordAttempt(url, attempt, durationMs, "success");
      this.config.metrics.recordTerminal(url, "success");
      span?.setAttribute("webhook.status", 200);
      span?.setAttribute("webhook.latency_ms", durationMs);
      span?.end();
      this.deadLetterStore?.recordSuccess(url);
      return;
    } catch (err) {
      if (this.watcher.stopped) {
        span?.end();
        return;
      }

      const durationMs = Date.now() - attemptStartedAt;
      this.config.metrics.recordAttempt(url, attempt, durationMs, "failure");

      const errorMessage = this.getErrorMessage(err);
      span?.setAttribute("webhook.status", "failure");
      span?.setAttribute("webhook.latency_ms", durationMs);
      span?.setAttribute("webhook.error", errorMessage);
      span?.end();

      if (attempt < this.config.retries) {
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
            },
          } as unknown as NormalizedEvent);
        }

        const backoffStrategy = this.config.backoff ?? exponentialJittered;
        const delay = backoffStrategy(attempt, this.config.random);
        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer);
          void this.deliverToUrl(event, url, attempt + 1);
        }, delay);
        this.retryTimers.set(retryTimer, { event, url });
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
    this.config.metrics.recordTerminal(url, "failure");

    let dlqId: string | undefined;
    if (this.deadLetterStore) {
      dlqId = this.deadLetterStore.add(url, event, errorMessage, attempt);
      this.deadLetterStore.recordFailure(url);
    }

    this.watcher.emit("webhook.failed", {
      ...event,
      raw: {
        error: errorMessage,
        url,
        attempts: attempt,
        originalEvent: event,
        ...(dlqId ? { dlqId } : {}),
      },
    } as unknown as NormalizedEvent);
  }

  getDeadLetterStore(): DeadLetterStore | undefined {
    return this.deadLetterStore;
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

    return createHmac("sha256", this.config.secret).update(signedPayload).digest("hex");
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

  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  if (timestampMs > nowMs + clockSkewMs) return false;

  if (options.maxAgeMs !== undefined) {
    if (timestampMs < nowMs - options.maxAgeMs - clockSkewMs) return false;
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return false;

  return true;
}
