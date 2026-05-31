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
}
