import type { RetryQueue, RetryRecord } from "../RetryQueue.js";

/**
 * In-memory implementation of RetryQueue.
 * Records are stored in a Map for O(1) lookup by ID, and maintained in sorted order by nextRetryAt.
 */
export class InMemoryRetryQueue implements RetryQueue {
  private records: Map<string, RetryRecord> = new Map();
  private inFlight: Map<string, RetryRecord> = new Map();
  private sortedByTime: RetryRecord[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);

    // Remove if already exists
    if (this.records.has(record.id)) {
      this.sortedByTime = this.sortedByTime.filter((r) => r.id !== record.id);
    }
    this.inFlight.delete(record.id);

    // Add to map
    this.records.set(record.id, record);

    // Insert into sorted array maintaining nextRetryAt order
    const insertIdx = this.sortedByTime.findIndex(
      (r) => r.nextRetryAt > record.nextRetryAt,
    );
    if (insertIdx === -1) {
      this.sortedByTime.push(record);
    } else {
      this.sortedByTime.splice(insertIdx, 0, record);
    }
  }

  async dequeue(nowMs = this.now()): Promise<RetryRecord | null> {
    // First record is earliest due to sort order
    const nextRecord = this.sortedByTime[0];

    // If no records or not ready yet, return null
    if (!nextRecord || nextRecord.nextRetryAt > nowMs) {
      return null;
    }

    // Remove from both storage structures
    this.sortedByTime.shift();
    this.records.delete(nextRecord.id);
    this.inFlight.set(nextRecord.id, nextRecord);

    return nextRecord;
  }

  async ack(recordId: string): Promise<void> {
    this.inFlight.delete(recordId);
    this.records.delete(recordId);
    this.sortedByTime = this.sortedByTime.filter((r) => r.id !== recordId);
  }

  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const record = this.inFlight.get(recordId);
    if (!record) return;

    this.inFlight.delete(recordId);
    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    await this.enqueue({
      ...record,
      nextRetryAt: this.now() + delayMs,
    });
  }

  async evictNewest(): Promise<RetryRecord | null> {
    const newest = this.sortedByTime.at(-1);
    if (!newest) return null;

    this.records.delete(newest.id);
    this.sortedByTime.pop();
    return newest;
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.inFlight.clear();
    this.sortedByTime = [];
  }

  async size(): Promise<number> {
    return this.records.size;
  }

  private assertRecord(record: RetryRecord): void {
    if (!record.id) {
      throw new Error("RetryRecord.id is required");
    }

    if (!Number.isFinite(record.nextRetryAt)) {
      throw new Error("RetryRecord.nextRetryAt must be a finite timestamp");
    }
  }
}
