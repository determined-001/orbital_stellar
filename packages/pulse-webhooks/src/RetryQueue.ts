export interface RetryRecord {
  webhookId: string;
  payload: any;
  attemptCount: number;
  nextRetryAt: number;
  createdAt: number;
  id?: string;
  url: string;
  event: any;
  attempt: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
}

export interface RetryQueue {
  enqueue(record: RetryRecord): void;
  dequeue(): RetryRecord | undefined;
  evictNewest(): RetryRecord | undefined;
  size(): number;
}

export class MemoryRetryQueue implements RetryQueue {
  private queue: RetryRecord[] = [];

  enqueue(record: RetryRecord): void {
    this.queue.push(record);
  }

  dequeue(): RetryRecord | undefined {
    const now = Date.now();
    const idx = this.queue.findIndex(r => r.nextRetryAt <= now);
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  evictNewest(): RetryRecord | undefined {
    return this.queue.pop();
  }

  size(): number {
    return this.queue.length;
  }
}
