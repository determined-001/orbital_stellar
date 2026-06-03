export interface RetryRecord {
  id?: string | number;
  url: string;
  event: any;
  attempt: number;
  nextAttemptAt: number;
}

export interface RetryQueue {
  enqueue(record: RetryRecord): Promise<void>;
  dequeue(): Promise<RetryRecord | null>;
  evictNewest(): Promise<RetryRecord | null>;
  size(): Promise<number>;
}

export class MemoryRetryQueue implements RetryQueue {
  private queue: RetryRecord[] = [];

  async enqueue(record: RetryRecord): Promise<void> {
    this.queue.push(record);
  }

  async dequeue(): Promise<RetryRecord | null> {
    return this.queue.shift() || null;
  }

  async evictNewest(): Promise<RetryRecord | null> {
    return this.queue.pop() || null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }
}
