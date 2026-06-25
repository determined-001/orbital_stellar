import type { RetryQueue, RetryRecord } from "./RetryQueue.js";

type RedisValue = number | string;

export type RedisLike = {
  zadd(key: string, score: number, member: string): RedisValue | Promise<RedisValue>;
  zrangebyscore(
    key: string,
    min: RedisValue,
    max: RedisValue,
    ...args: RedisValue[]
  ): string[] | Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): string[] | Promise<string[]>;
  zrem(key: string, member: string): RedisValue | Promise<RedisValue>;
  zcard(key: string): RedisValue | Promise<RedisValue>;
};

export type RedisRetryQueueOptions = {
  keyPrefix?: string;
  queueName?: string;
  now?: () => number;
  scanBatchSize?: number;
  visibilityTimeoutMs?: number;
};

const DEFAULT_KEY_PREFIX = "orbital:pulse-webhooks";
const DEFAULT_QUEUE_NAME = "default";
const DEFAULT_SCAN_BATCH_SIZE = 10;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

export class RedisRetryQueue implements RetryQueue {
  readonly key: string;
  readonly inFlightKey: string;

  private readonly client: RedisLike;
  private readonly now: () => number;
  private readonly scanBatchSize: number;
  private readonly visibilityTimeoutMs: number;

  constructor(client: RedisLike, options: RedisRetryQueueOptions = {}) {
    this.client = client;
    this.now = options.now ?? Date.now;
    this.scanBatchSize = Math.max(1, Math.floor(options.scanBatchSize ?? DEFAULT_SCAN_BATCH_SIZE));
    this.visibilityTimeoutMs = Math.max(
      1,
      Math.floor(options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS),
    );

    const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
    this.key = `${keyPrefix}:retry-queue:${queueName}`;
    this.inFlightKey = `${this.key}:in-flight`;
  }

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);
    await this.client.zadd(this.key, record.nextRetryAt, JSON.stringify(record));
  }

  async dequeue(nowMs = this.now()): Promise<RetryRecord | null> {
    await this.reclaimExpiredInFlight(nowMs);

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
      if (!record) continue;

      await this.client.zadd(
        this.inFlightKey,
        nowMs + this.visibilityTimeoutMs,
        JSON.stringify(record),
      );
      return record;
    }

    return null;
  }

  async ack(recordId: string): Promise<void> {
    const member = await this.findInFlightMemberById(recordId);
    if (!member) return;

    await this.client.zrem(this.inFlightKey, member);
  }

  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const member = await this.findInFlightMemberById(recordId);
    if (!member) return;

    const removed = Number(await this.client.zrem(this.inFlightKey, member));
    if (removed === 0) return;

    const record = this.parseRecord(member);
    if (!record) return;

    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    const nextRetryAt = this.now() + delayMs;

    await this.enqueue({
      ...record,
      nextRetryAt,
    });
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

  private async reclaimExpiredInFlight(nowMs: number): Promise<void> {
    for (;;) {
      const expiredMembers = await this.client.zrangebyscore(
        this.inFlightKey,
        "-inf",
        nowMs,
        "LIMIT",
        0,
        this.scanBatchSize,
      );
      if (expiredMembers.length === 0) return;

      for (const member of expiredMembers) {
        const removed = Number(await this.client.zrem(this.inFlightKey, member));
        if (removed === 0) continue;

        const record = this.parseRecord(member);
        if (!record) continue;

        await this.client.zadd(
          this.key,
          nowMs,
          JSON.stringify({
            ...record,
            nextRetryAt: nowMs,
          }),
        );
      }
    }
  }

  private async findInFlightMemberById(recordId: string): Promise<string | null> {
    let offset = 0;

    for (;;) {
      const members = await this.client.zrangebyscore(
        this.inFlightKey,
        "-inf",
        "+inf",
        "LIMIT",
        offset,
        this.scanBatchSize,
      );
      if (members.length === 0) return null;

      for (const member of members) {
        const record = this.parseRecord(member);
        if (record?.id === recordId) return member;
      }

      offset += members.length;
    }
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
