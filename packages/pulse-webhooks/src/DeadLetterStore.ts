import type { DeadLetterStore, DeadLetterRecord, DeadLetterFilter } from "./types.js";

/**
 * MemoryDeadLetterStore — An in-memory DeadLetterStore implementation.
 * Keeps up to a configured cap of records, evicting the oldest via FIFO.
 */
export class MemoryDeadLetterStore implements DeadLetterStore {
  private records: DeadLetterRecord[] = [];
  private readonly cap: number;

  constructor(cap = 1000) {
    this.cap = cap;
  }

  /**
   * Records a terminal webhook failure or drop.
   * Generates a unique ID and timestamp, and manages FIFO cap eviction.
   */
  async record(failure: Omit<DeadLetterRecord, "id" | "timestamp">): Promise<void> {
    const record: DeadLetterRecord = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      timestamp: Date.now(),
      ...failure,
    };

    if (this.records.length >= this.cap) {
      this.records.shift(); // FIFO eviction
    }

    this.records.push(record);
  }

  /**
   * Lists and filters dead letter records.
   */
  async list(filter?: DeadLetterFilter): Promise<DeadLetterRecord[]> {
    if (!filter) {
      return [...this.records];
    }

    return this.records.filter(r => {
      if (filter.url && r.url !== filter.url) return false;
      if (filter.type && r.event?.type !== filter.type) return false;
      if (filter.reason && r.reason !== filter.reason && r.error !== filter.reason) return false;
      return true;
    });
  }
}
