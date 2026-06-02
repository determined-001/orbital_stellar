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

  /**
   * Retrieve a specific entry by ID.
   */
  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Remove an entry from the store.
   */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Clear all entries from the store.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get total number of entries in the store.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Record a successful delivery for a URL (called by WebhookDelivery on success).
   */
  recordSuccess(url: string): void {
    this.successTimestamps.set(url, Date.now());
  }

  /**
   * Get delivery health metrics for a webhook URL.
   *
   * Health rule:
   * - healthy = true when:
   *   - failure rate < 5% in the last hour
   *   - AND at least one success in the last 15 minutes
   *
   * @param url The webhook URL to check
   * @returns Health metrics: { healthy, lastSuccess, lastFailure, failureRate }
   */
  getHealth(url: string): DeadLetterHealth {
    const nowMs = Date.now();
    const oneHourAgoMs = nowMs - 60 * 60 * 1000;
    const fifteenMinutesAgoMs = nowMs - 15 * 60 * 1000;

    // Get all failures for this URL in the last hour
    const recentFailures = this.list({
      url,
      since: oneHourAgoMs,
    });

    // Get the last success timestamp for this URL
    const lastSuccessMs = this.successTimestamps.get(url);

    // Get the last failure timestamp
    const lastFailureMs =
      recentFailures.length > 0
        ? recentFailures[recentFailures.length - 1]!.timestamp
        : undefined;

    // Calculate failure rate
    // For health check, we need total attempts in the last hour
    // If no failures in the hour, rate is 0% (all successes)
    const failureRate =
      recentFailures.length === 0
        ? 0
        : recentFailures.length / (recentFailures.length + 1); // +1 assumed success

    // Determine health: < 5% failure rate AND success within 15 minutes
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

// Global singleton for tracking delivery health across all WebhookDelivery instances
const globalDLQ = new DeadLetterStore();

/**
 * Get delivery health metrics for a webhook URL from the global dead letter store.
 *
 * Health rule:
 * - healthy = true when:
 *   - failure rate < 5% in the last hour
 *   - AND at least one success in the last 15 minutes
 *
 * @param url The webhook URL to check
 * @returns Health metrics: { healthy, lastSuccess, lastFailure, failureRate }
 */
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
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
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
        // Enforce the retry cap — evict the newest pending retry when at limit.
        if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
          // Evict the newest (last-inserted) retry — it has waited the least, so dropping it wastes the least elapsed time.
          const newestTimer = [...this.retryTimers.keys()].at(-1)!;
          const newest = this.retryTimers.get(newestTimer)!;
          clearTimeout(newestTimer);
          this.retryTimers.delete(newestTimer);

          // Add to dead letter store
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
        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer);
          void this.deliverToUrl(event, url, attempt + 1);
        }, delay);
        this.retryTimers.set(retryTimer, { event, url });
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
