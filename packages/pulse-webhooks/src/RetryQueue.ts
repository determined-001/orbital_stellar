import type { RetryQueue, RetryRecord } from "./types.js";

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
