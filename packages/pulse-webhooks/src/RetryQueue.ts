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
  evictNewest(): Promise<RetryRecord | null>;
  size(): Promise<number>;
};
