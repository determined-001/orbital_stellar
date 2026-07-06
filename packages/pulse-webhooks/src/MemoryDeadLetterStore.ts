import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

import type {
  DeadLetterEntry,
  DeadLetterFailure,
  DeadLetterFilter,
  DeadLetterStore,
  ReplayHandler,
} from "./DeadLetterStore.js";

export type { DeadLetterEntry, DeadLetterFilter } from "./DeadLetterStore.js";

export interface DeliveryHealth {
  healthy: boolean;
  lastSuccess?: number;
  lastFailure?: number;
  /** Failure rate over the last hour, as a percentage (0-100). */
  failureRate: number;
}

export type MemoryDeadLetterStoreOptions = {
  /** Maximum stored failures before FIFO eviction. Defaults to 1000. */
  maxEntries?: number;
  replay?: ReplayHandler;
};

interface UrlMetrics {
  lastSuccess?: number;
  lastFailure?: number;
  successCount: number;
  failureCount: number;
  successes: number[];
  failures: number[];
}

let counter = 0;

const DEFAULT_MAX_ENTRIES = 1000;

/**
 * In-memory dead-letter store with FIFO eviction and per-URL health tracking.
 *
 * {@link WebhookDelivery} populates terminal failures automatically when this
 * store is passed as the configured dead-letter dependency.
 */
export class MemoryDeadLetterStore implements DeadLetterStore {
  private readonly maxEntries: number;
  private replayHandler?: ReplayHandler;
  private entries: Map<string, DeadLetterEntry> = new Map();
  private metrics: Map<string, UrlMetrics> = new Map();

  constructor(options: MemoryDeadLetterStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.replayHandler = options.replay;
  }

  setReplayHandler(handler: ReplayHandler): void {
    this.replayHandler = handler;
  }

  async record(failure: DeadLetterFailure): Promise<string> {
    const timestamp = failure.failedAt ?? Date.now();
    const id = `dlq_${++counter}_${timestamp}_${Math.random().toString(36).slice(2)}`;
    this.entries.set(id, {
      id,
      url: failure.url,
      event: failure.event,
      error: failure.error,
      attempts: failure.attempts,
      timestamp,
      replayedAt: null,
    });
    this.evictOldestIfNeeded();
    return id;
  }

  async list(filter: DeadLetterFilter = {}): Promise<DeadLetterEntry[]> {
    let results = [...this.entries.values()];

    if (filter.url !== undefined) results = results.filter((e) => e.url === filter.url);
    if (filter.since !== undefined) results = results.filter((e) => e.timestamp >= filter.since!);
    if (filter.until !== undefined) results = results.filter((e) => e.timestamp <= filter.until!);

    results.sort((a, b) => a.timestamp - b.timestamp);

    if (filter.limit !== undefined) results = results.slice(0, filter.limit);
    return results;
  }

  async replay(failureId: string): Promise<void> {
    const entry = this.entries.get(failureId);
    if (!entry) {
      throw new Error(`Unknown dead-letter failure: ${failureId}`);
    }
    if (!this.replayHandler) {
      throw new Error("Dead-letter replay handler is not configured");
    }

    await this.replayHandler(entry);
    entry.replayedAt = Date.now();
  }

  async failureRate(url: string, windowMs: number): Promise<number> {
    const metrics = this.metrics.get(url);
    if (!metrics) return 0;

    const cutoff = Date.now() - windowMs;
    const recentFailures = metrics.failures.filter((ts) => ts > cutoff);
    const recentSuccesses = metrics.successes.filter((ts) => ts > cutoff);
    const totalEvents = recentFailures.length + recentSuccesses.length;

    if (totalEvents === 0) return 0;
    return Math.round((recentFailures.length / totalEvents) * 10000) / 100;
  }

  /** @deprecated Use {@link record} instead. */
  add(url: string, event: NormalizedEvent, error: string, attempts: number): string {
    const id = `dlq_${++counter}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.entries.set(id, {
      id,
      url,
      event,
      error,
      attempts,
      timestamp: Date.now(),
      replayedAt: null,
    });
    this.evictOldestIfNeeded();
    return id;
  }

  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
    this.metrics.clear();
  }

  size(): number {
    return this.entries.size;
  }

  /** Record a successful delivery to a URL (health tracking). */
  recordSuccess(url: string, timestamp: number = Date.now()): void {
    const metrics = this.getOrCreateMetrics(url);
    metrics.lastSuccess = timestamp;
    metrics.successCount++;
    metrics.successes.push(timestamp);
    this.pruneOldEntries(metrics);
  }

  /** Record a failed delivery attempt for a URL (health tracking). */
  recordFailure(url: string, timestamp: number = Date.now()): void {
    const metrics = this.getOrCreateMetrics(url);
    metrics.lastFailure = timestamp;
    metrics.failureCount++;
    metrics.failures.push(timestamp);
    this.pruneOldEntries(metrics);
  }

  /**
   * Get health metrics for a URL.
   *
   * Healthy when failure rate is below 5% over the last hour AND there was at
   * least one success in the last 15 minutes.
   */
  getHealth(url: string): DeliveryHealth {
    const metrics = this.metrics.get(url);
    if (!metrics) {
      return { healthy: false, failureRate: 0 };
    }

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const fifteenMinutesAgo = now - 15 * 60 * 1000;

    const recentFailures = metrics.failures.filter((ts) => ts > oneHourAgo);
    const recentSuccesses = metrics.successes.filter((ts) => ts > oneHourAgo);

    const totalEvents = recentFailures.length + recentSuccesses.length;
    const rate = totalEvents > 0 ? recentFailures.length / totalEvents : 0;
    const recentSuccessExists = recentSuccesses.some((ts) => ts > fifteenMinutesAgo);

    return {
      healthy: rate < 0.05 && recentSuccessExists,
      lastSuccess: metrics.lastSuccess,
      lastFailure: metrics.lastFailure,
      failureRate: Math.round(rate * 10000) / 100,
    };
  }

  /** All URLs with tracked health metrics. */
  getAllUrls(): string[] {
    return [...this.metrics.keys()];
  }

  private evictOldestIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId === undefined) break;
      this.entries.delete(oldestId);
    }
  }

  private getOrCreateMetrics(url: string): UrlMetrics {
    let metrics = this.metrics.get(url);
    if (!metrics) {
      metrics = {
        lastSuccess: undefined,
        lastFailure: undefined,
        successCount: 0,
        failureCount: 0,
        successes: [],
        failures: [],
      };
      this.metrics.set(url, metrics);
    }
    return metrics;
  }

  /** Drop health timestamps older than the window to bound memory. */
  private pruneOldEntries(metrics: UrlMetrics, windowMs: number = 60 * 60 * 1000): void {
    const cutoff = Date.now() - windowMs;
    metrics.successes = metrics.successes.filter((ts) => ts > cutoff);
    metrics.failures = metrics.failures.filter((ts) => ts > cutoff);
  }
}
