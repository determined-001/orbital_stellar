import type { RetryQueue, RetryRecord } from "./types.js";

/**
 * MemoryRetryQueue — A reference in-memory implementation of the RetryQueue interface.
 * Matches FIFO dequeue behavior and LIFO eviction behavior.
 */
export class MemoryRetryQueue implements RetryQueue {
  private queue: RetryRecord[] = [];

  /**
   * Enqueues a retry record at the end of the queue.
   */
  async enqueue(record: RetryRecord): Promise<void> {
    this.queue.push(record);
  }

  /**
   * Dequeues (removes and returns) the oldest record from the queue (FIFO).
   */
  async dequeue(): Promise<RetryRecord | null> {
    return this.queue.shift() || null;
  }

  /**
   * Evicts (removes and returns) the newest (last-inserted) record from the queue (LIFO).
   */
  async evictNewest(): Promise<RetryRecord | null> {
    return this.queue.pop() || null;
  }

  /**
   * Returns the current number of items in the queue.
   */
  async size(): Promise<number> {
    return this.queue.length;
  }
}
