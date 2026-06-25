import type { NormalizedEvent } from "./types";

/**
 * A record representing a webhook delivery retry scheduled for a future time.
 */
export interface RetryRecord {
  /** Unique identifier for this retry record */
  id: string;
  /** The normalized event to deliver */
  event: NormalizedEvent;
  /** The webhook URL to deliver to */
  url: string;
  /** Attempt number (1-based) */
  attempt: number;
  /** Unix timestamp (milliseconds) when this record is eligible for dequeue and retry */
  nextRetryAt: number;
  /** Unix timestamp (milliseconds) when this record was created */
  createdAt: number;
}

/**
 * A durable queue for managing webhook delivery retries.
 * Records are ordered by nextRetryAt; dequeue() only returns records whose nextRetryAt <= now.
 */
export interface RetryQueue {
  /**
   * Add a retry record to the queue.
   */
  enqueue(record: RetryRecord): Promise<void>;

  /**
   * Remove and return the next record whose nextRetryAt <= now, or null if no records are ready.
   * Records whose nextRetryAt is in the future remain in the queue.
   */
  dequeue(): Promise<RetryRecord | null>;

  /**
   * Mark a record as processed, removing it from the queue.
   */
  ack(recordId: string): Promise<void>;

  /**
   * Clear all records from the queue.
   */
  clear(): Promise<void>;

  /**
   * Get the total number of records in the queue (both ready and pending).
   */
  dequeue(nowMs?: number): Promise<RetryRecord | null>;
  ack(recordId: string): Promise<void>;
  nack(recordId: string, requeueDelayMs: number): Promise<void>;
  evictNewest(): Promise<RetryRecord | null>;
  size(): Promise<number>;
}
