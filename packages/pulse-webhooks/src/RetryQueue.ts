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
