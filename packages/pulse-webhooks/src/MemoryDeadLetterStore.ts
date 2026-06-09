import type { NormalizedEvent } from "@orbital/pulse-core";

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

let counter = 0;

export class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();

  // Health metrics per URL (success/failure timestamps and counts)
  private metrics: Map<string, UrlMetrics> = new Map();

  /**
   * Record a successful delivery to a URL for health calculations.
   */
  recordSuccess(url: string, timestamp: number = Date.now()): void {
    const metrics = this.getOrCreateMetrics(url);
    metrics.lastSuccess = timestamp;
    metrics.successCount++;
    metrics.successes.push(timestamp);
    this.pruneOldEntries(metrics);
  }

  /**
   * Record a failed delivery attempt for a URL for health calculations.
   */
  recordFailure(url: string, timestamp: number = Date.now()): void {
    const metrics = this.getOrCreateMetrics(url);
    metrics.lastFailure = timestamp;
    metrics.failureCount++;
    metrics.failures.push(timestamp);
    this.pruneOldEntries(metrics);
  }

  /**
   * Get health metrics for a URL.
   */
  getHealth(url: string): DeliveryHealth {
    const metrics = this.metrics.get(url);

    if (!metrics) {
      return {
        healthy: false,
        failureRate: 0,
      };
    }

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const fifteenMinutesAgo = now - 15 * 60 * 1000;

    const recentFailures = metrics.failures.filter((ts) => ts > oneHourAgo);
    const recentSuccesses = metrics.successes.filter((ts) => ts > oneHourAgo);

    const totalEvents = recentFailures.length + recentSuccesses.length;
    const failureRate = totalEvents > 0 ? recentFailures.length / totalEvents : 0;

    const recentSuccessExists = recentSuccesses.some((ts) => ts > fifteenMinutesAgo);

    const healthy = failureRate < 0.05 && recentSuccessExists;

    return {
      healthy,
      lastSuccess: metrics.lastSuccess,
      lastFailure: metrics.lastFailure,
      failureRate: Math.round(failureRate * 10000) / 100,
    };
  }

  getAllUrls(): string[] {
    return Array.from(this.metrics.keys());
  }

  add(url: string, event: NormalizedEvent, error: string, attempts: number): string {
    const id = `dlq_${++counter}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.entries.set(id, { id, url, event, error, attempts, timestamp: Date.now() });
    return id;
  }

  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  list(filter: DeadLetterFilter = {}): DeadLetterEntry[] {
    let results = [...this.entries.values()];

    if (filter.url !== undefined) results = results.filter((e) => e.url === filter.url);
    if (filter.since !== undefined) results = results.filter((e) => e.timestamp >= filter.since!);
    if (filter.until !== undefined) results = results.filter((e) => e.timestamp <= filter.until!);

    results.sort((a, b) => a.timestamp - b.timestamp);

    if (filter.limit !== undefined) results = results.slice(0, filter.limit);
    return results;
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

  private getOrCreateMetrics(url: string): UrlMetrics {
    if (!this.metrics.has(url)) {
      this.metrics.set(url, {
        lastSuccess: undefined,
        lastFailure: undefined,
        successCount: 0,
        failureCount: 0,
        successes: [],
        failures: [],
      });
    }
    return this.metrics.get(url)!;
  }

  private pruneOldEntries(metrics: UrlMetrics, windowMs: number = 60 * 60 * 1000): void {
    const cutoff = Date.now() - windowMs;
    metrics.successes = metrics.successes.filter((ts) => ts > cutoff);
    metrics.failures = metrics.failures.filter((ts) => ts > cutoff);
  }
}

interface UrlMetrics {
  lastSuccess?: number;
  lastFailure?: number;
  successCount: number;
  failureCount: number;
  successes: number[];
  failures: number[];
}

export interface DeliveryHealth {
  healthy: boolean;
  lastSuccess?: number;
  lastFailure?: number;
  failureRate: number;
}
