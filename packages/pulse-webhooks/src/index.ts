import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";
export { verifyWebhookEdge } from "./edge.js";
export type { Span, Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url" | "tracer" | "urlValidator"> & {
  urls: string[];
  tracer?: Tracer;
  urlValidator?: WebhookConfig["urlValidator"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
  private retryTimers: Map<ReturnType<typeof setTimeout>, { event: NormalizedEvent; url: string }> = new Map();

  constructor(watcher: Watcher, config: WebhookConfig) {
    this.watcher = watcher;
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

        const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
        const delay = Math.floor(this.config.random() * exponentialDelay);
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
