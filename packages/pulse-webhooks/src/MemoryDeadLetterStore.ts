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

export interface DeadLetterHealth {
  healthy: boolean;
  lastSuccess?: number;
  lastFailure?: number;
  failureRate: number;
}

let counter = 0;

export class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private successTimestamps: Map<string, number> = new Map(); // url -> last success timestamp

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
