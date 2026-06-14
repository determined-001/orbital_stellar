export type RetryRecord<Event = unknown> = {
  id: string;
  event: Event;
  url: string;
  attempt: number;
  nextRetryAt: number;
  lastError?: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
};

export type RetryQueue = {
  enqueue(record: RetryRecord): Promise<void>;
  dequeue(nowMs?: number): Promise<RetryRecord | null>;
  ack(recordId: string): Promise<void>;
  nack(recordId: string, requeueDelayMs: number): Promise<void>;
  evictNewest(): Promise<RetryRecord | null>;
  size(): Promise<number>;
};

export class MemoryRetryQueue implements RetryQueue {
  private queue: RetryRecord[] = [];

  async enqueue(record: RetryRecord): Promise<void> {
    this.queue.push(record);
  }

  async dequeue(nowMs?: number): Promise<RetryRecord | null> {
    const cutoff = nowMs ?? Date.now();
    const idx = this.queue.findIndex((r) => r.nextRetryAt <= cutoff);
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0] ?? null;
  }

  async ack(_recordId: string): Promise<void> {
    // no-op for in-memory
  }

  async nack(_recordId: string, _requeueDelayMs: number): Promise<void> {
    // no-op for in-memory
  }

  async evictNewest(): Promise<RetryRecord | null> {
    return this.queue.pop() ?? null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }
}
