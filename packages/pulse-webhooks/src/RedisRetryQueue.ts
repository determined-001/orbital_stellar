import type { RetryQueue, RetryRecord } from "./RetryQueue.js";

type RedisValue = number | string;

export type RedisLike = {
  zadd(
    key: string,
    score: number,
    member: string,
  ): RedisValue | Promise<RedisValue>;
  zrangebyscore(
    key: string,
    min: RedisValue,
    max: RedisValue,
    ...args: RedisValue[]
  ): string[] | Promise<string[]>;
  zrevrange(
    key: string,
    start: number,
    stop: number,
  ): string[] | Promise<string[]>;
  zrem(key: string, member: string): RedisValue | Promise<RedisValue>;
  zcard(key: string): RedisValue | Promise<RedisValue>;
};

export type RedisRetryQueueOptions = {
  keyPrefix?: string;
  queueName?: string;
  now?: () => number;
  scanBatchSize?: number;
};

const DEFAULT_KEY_PREFIX = "orbital:pulse-webhooks";
const DEFAULT_QUEUE_NAME = "default";
const DEFAULT_SCAN_BATCH_SIZE = 10;

export class RedisRetryQueue implements RetryQueue {
  readonly key: string;

  private readonly client: RedisLike;
  private readonly now: () => number;
  private readonly scanBatchSize: number;

  constructor(client: RedisLike, options: RedisRetryQueueOptions = {}) {
    this.client = client;
    this.now = options.now ?? Date.now;
    this.scanBatchSize = Math.max(
      1,
      Math.floor(options.scanBatchSize ?? DEFAULT_SCAN_BATCH_SIZE),
    );

    const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
    this.key = `${keyPrefix}:retry-queue:${queueName}`;
  }

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);
    await this.client.zadd(this.key, record.nextRetryAt, JSON.stringify(record));
  }

  async dequeue(nowMs = this.now()): Promise<RetryRecord | null> {
    const members = await this.client.zrangebyscore(
      this.key,
      "-inf",
      nowMs,
      "LIMIT",
      0,
      this.scanBatchSize,
    );

    for (const member of members) {
      const removed = Number(await this.client.zrem(this.key, member));
      if (removed === 0) continue;

      const record = this.parseRecord(member);
      if (record) return record;
    }

    return null;
  }

  async evictNewest(): Promise<RetryRecord | null> {
    const [member] = await this.client.zrevrange(this.key, 0, 0);
    if (!member) return null;

    const removed = Number(await this.client.zrem(this.key, member));
    if (removed === 0) return null;

    return this.parseRecord(member);
  }

  async size(): Promise<number> {
    return Number(await this.client.zcard(this.key));
  }

  private assertRecord(record: RetryRecord): void {
    if (!record.id) {
      throw new Error("RetryRecord.id is required");
    }

    if (!Number.isFinite(record.nextRetryAt)) {
      throw new Error("RetryRecord.nextRetryAt must be a finite timestamp");
    }
  }

  private parseRecord(member: string): RetryRecord | null {
    try {
      return JSON.parse(member) as RetryRecord;
    } catch {
      return null;
    }
  }
}
