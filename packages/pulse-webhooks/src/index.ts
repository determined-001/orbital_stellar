import type {
  NormalizedEvent,
  Watcher,
  WatcherNotification,
} from "@orbital/pulse-core";
import { createHmac, timingSafeEqual } from "crypto";

import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";
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
  private successTimestamps: Map<string, number> = new Map(); // url -> last success timestamp

  /**
   * Add a failed webhook delivery to the dead letter store.
   */
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

  /**
   * Query the dead letter store with optional filters.
   * Returns entries matching all provided filters.
   *
   * @param filter - Filter criteria { url?, since?, until?, limit? }
   * @returns Array of matching DeadLetterEntry objects
   *
   * Filter behavior:
   * - url: exact string match
   * - since: timestamp >= since (inclusive)
   * - until: timestamp <= until (inclusive)
   * - limit: return at most limit entries (from oldest first)
   */
  list(filter: DeadLetterFilter = {}): DeadLetterEntry[] {
    let results = Array.from(this.entries.values());

    // Filter by URL
    if (filter.url !== undefined) {
      results = results.filter((entry) => entry.url === filter.url);
    }

    // Filter by time range
    if (filter.since !== undefined) {
      results = results.filter((entry) => entry.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter((entry) => entry.timestamp <= filter.until!);
    }

    // Sort by timestamp (oldest first) for consistent ordering
    results.sort((a, b) => a.timestamp - b.timestamp);

    // Apply limit
    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

type ResolvedWebhookConfig = Omit<Required<WebhookConfig>, "url" | "tracer" | "urlValidator" | "retryQueue"> & {
  urls: string[];
  tracer?: Tracer;
  urlValidator?: WebhookConfig["urlValidator"];
  retryQueue?: WebhookConfig["retryQueue"];
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private dlq: DeadLetterStore;
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
  private retryTimers: Map<ReturnType<typeof setTimeout>, { event: NormalizedEvent; url: string }> = new Map();
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(watcher: Watcher, config: WebhookConfig, dlq?: DeadLetterStore) {
    this.watcher = watcher;
    this.dlq = dlq ?? globalDLQ;
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      random: Math.random,
      pollIntervalMs: 1000,
      ...config,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
      retryQueue: config.retryQueue,
    };
    this.config.maxConcurrentRetries = Math.max(
      1,
      this.config.maxConcurrentRetries,
    );

    this.watcher.addStopHandler(() => {
      this.clearRetryTimers();
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    });

    if (this.config.retryQueue) {
      this.pollTimer = setInterval(() => {
        void this.pollQueue();
      }, this.config.pollIntervalMs);
    }

    this.watcher.on("*", (event: NormalizedEvent | WatcherNotification) => {
      if ("raw" in event) {
        for (const url of this.config.urls) {
          void this.deliverToUrl(event, url);
        }
      }
    });
  }

  /**
   * Get the dead letter store for this delivery instance.
   */
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

      // Record successful delivery for health metrics
      this.dlq.recordSuccess(url);
    } catch (err) {
      if (this.watcher.stopped) return;

      const errorMessage = this.getErrorMessage(err);

      if (attempt < this.config.retries) {
        const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
        const delay = Math.floor(this.config.random() * exponentialDelay);

        if (this.config.retryQueue) {
          try {
            const currentSize = await this.config.retryQueue.size();
            if (currentSize >= this.config.maxConcurrentRetries) {
              const evicted = await this.config.retryQueue.evictNewest();
              if (evicted) {
                this.watcher.emit("webhook.dropped", {
                  ...(evicted.event as any),
                  raw: {
                    reason: "retry_cap_exceeded",
                    url: evicted.url,
                    maxConcurrentRetries: this.config.maxConcurrentRetries,
                    originalEvent: evicted.event,
                  },
                } as unknown as NormalizedEvent);
              }
            }

            const nextRetryAt = Date.now() + delay;
            const uniqueId = `${event.raw && typeof event.raw === "object" && "id" in event.raw ? (event.raw as any).id : "evt"}-${url}-${attempt + 1}-${Date.now()}-${Math.floor(this.config.random() * 1000)}`;

            await this.config.retryQueue.enqueue({
              id: uniqueId,
              event,
              url,
              attempt: attempt + 1,
              nextRetryAt,
              lastError: errorMessage,
              createdAt: Date.now(),
            });
          } catch (queueErr) {
            this.emitFailure(event, url, `Failed to enqueue retry: ${this.getErrorMessage(queueErr)}`, attempt);
          }
        } else {
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

          const retryTimer = setTimeout(() => {
            this.retryTimers.delete(retryTimer);
            void this.deliverToUrl(event, url, attempt + 1);
          }, delay);
          this.retryTimers.set(retryTimer, { event, url });
        }
      } else {
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
      }
    } finally {
      clearTimeout(abortTimer);
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

  private async pollQueue(): Promise<void> {
    if (this.watcher.stopped) return;
    if (!this.config.retryQueue) return;

    try {
      while (true) {
        if (this.watcher.stopped) break;
        const record = await this.config.retryQueue.dequeue();
        if (!record) break;

        void this.deliverToUrl(record.event as NormalizedEvent, record.url, record.attempt);
      }
    } catch (err) {
      // Ignore background dequeue errors
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

/**
 * Verifies webhook signature and returns parsed event.
 * Use when you need to access the event payload immediately.
 *
 * @param payload - The raw request body
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @returns Parsed NormalizedEvent if verification succeeds, null otherwise
 */
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

/**
 * Verifies webhook signature without parsing JSON.
 * Use when routing raw body to another consumer (e.g., queue) to avoid parse overhead.
 *
 * @param payload - The raw request body
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @returns true if signature is valid, false otherwise
 */
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
