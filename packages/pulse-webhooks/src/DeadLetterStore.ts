/**
 * Tracks per-URL webhook delivery metrics for health monitoring.
 * Stores success/failure timestamps within a rolling window for health calculation.
 */
export class DeadLetterStore {
  private metrics: Map<string, UrlMetrics> = new Map();

  /**
   * Record a successful delivery to a URL.
   * @param url The webhook URL
   * @param timestamp The delivery timestamp (defaults to now)
   */
  recordSuccess(url: string, timestamp: number = Date.now()): void {
    const metrics = this.getOrCreateMetrics(url);
    metrics.lastSuccess = timestamp;
    metrics.successCount++;
    metrics.successes.push(timestamp);
    this.pruneOldEntries(metrics);
  }

  /**
   * Record a failed delivery attempt for a URL.
   * @param url The webhook URL
   * @param timestamp The delivery timestamp (defaults to now)
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
   *
   * Health rule:
   * - healthy = true when:
   *   - failure rate < 5% in the last hour
   *   - AND at least one success in the last 15 minutes
   *
   * @param url The webhook URL
   * @returns Health metrics: { healthy, lastSuccess, lastFailure, failureRate }
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

    // Count failures and successes in the last hour
    const recentFailures = metrics.failures.filter((ts) => ts > oneHourAgo);
    const recentSuccesses = metrics.successes.filter((ts) => ts > oneHourAgo);

    const totalEvents = recentFailures.length + recentSuccesses.length;
    const failureRate =
      totalEvents > 0 ? recentFailures.length / totalEvents : 0;

    // Check if there was a success in the last 15 minutes
    const recentSuccessExists = recentSuccesses.some(
      (ts) => ts > fifteenMinutesAgo,
    );

    // Healthy if: failure rate < 5% AND recent success exists
    const healthy = failureRate < 0.05 && recentSuccessExists;

    return {
      healthy,
      lastSuccess: metrics.lastSuccess,
      lastFailure: metrics.lastFailure,
      failureRate: Math.round(failureRate * 10000) / 100, // Round to 2 decimal places
    };
  }

  /**
   * Get all tracked URLs
   */
  getAllUrls(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clear(): void {
    this.metrics.clear();
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

  /**
   * Remove timestamps older than 1 hour to prevent unbounded memory growth
   */
  private pruneOldEntries(
    metrics: UrlMetrics,
    windowMs: number = 60 * 60 * 1000,
  ): void {
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
  failureRate: number; // 0-100
}
