//redis-retry-queue.ts
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
  /** Reads one field of the record-id -> member index. */
  hget(key: string, field: string): string | null | Promise<string | null>;
  /**
   * Runs a Lua script server-side. Every set transition in this queue goes
   * through one of the scripts below, so each transition is atomic without
   * assuming a particular client's `MULTI`/pipeline surface.
   *
   * The variadic `(script, numKeys, ...keysAndArgs)` shape is ioredis's, the
   * same convention the `zrangebyscore(key, min, max, "LIMIT", ...)` calls here
   * already assume.
   */
  eval(script: string, numKeys: number, ...keysAndArgs: RedisValue[]): unknown | Promise<unknown>;
};

export type RedisRetryQueueOptions = {
  keyPrefix?: string;
  queueName?: string;
  now?: () => number;
  visibilityTimeoutMs?: number;
};

const DEFAULT_KEY_PREFIX = "orbital:pulse-webhooks";
const DEFAULT_QUEUE_NAME = "default";
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

/**
 * How many due members a single `dequeue`/reclaim pass reads at a time. This is
 * a score-ranged read from the head of the set, never an offset walk over a
 * concurrently mutating set, so a competing worker's `zrem` can shift nothing
 * out from under it - the next iteration re-reads from the head.
 */
const SCAN_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Lua scripts. KEYS are always, in order:
//   1 queue zset  2 queue index hash  3 in-flight zset  4 in-flight index hash
//
// Every script is a single atomic step: Redis runs a script to completion
// before serving anything else, so a process dying mid-call can never leave a
// record in neither set (nor in both).
// ---------------------------------------------------------------------------

/** Adds/replaces a queued record. ARGV: id, score, member. */
export const ENQUEUE_SCRIPT = `
local previous = redis.call('HGET', KEYS[2], ARGV[1])
if previous then
  redis.call('ZREM', KEYS[1], previous)
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1
`;

/** Claims one due member into the in-flight set. ARGV: member, id, expiresAt. */
export const CLAIM_SCRIPT = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then
  return 0
end
if redis.call('HGET', KEYS[2], ARGV[2]) == ARGV[1] then
  redis.call('HDEL', KEYS[2], ARGV[2])
end
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[4], ARGV[2], ARGV[1])
return 1
`;

/** Drops an in-flight record for good. ARGV: id. */
export const ACK_SCRIPT = `
local member = redis.call('HGET', KEYS[4], ARGV[1])
if not member then
  return 0
end
redis.call('ZREM', KEYS[3], member)
redis.call('HDEL', KEYS[4], ARGV[1])
return 1
`;

/**
 * Moves an in-flight record back to the queue under a new schedule.
 * ARGV: id, score, newMember, expectedMember.
 *
 * `expectedMember` guards the read the caller did to build `newMember`: if the
 * in-flight member changed in between, this is a stale requeue and does nothing.
 */
export const REQUEUE_SCRIPT = `
local member = redis.call('HGET', KEYS[4], ARGV[1])
if not member or member ~= ARGV[4] then
  return 0
end
if redis.call('ZREM', KEYS[3], member) == 0 then
  redis.call('HDEL', KEYS[4], ARGV[1])
  return 0
end
redis.call('HDEL', KEYS[4], ARGV[1])
local previous = redis.call('HGET', KEYS[2], ARGV[1])
if previous then
  redis.call('ZREM', KEYS[1], previous)
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1
`;

/**
 * Reclaims one expired in-flight member back onto the queue.
 * ARGV: member, id, score, newMember.
 */
export const RECLAIM_SCRIPT = `
if redis.call('ZREM', KEYS[3], ARGV[1]) == 0 then
  return 0
end
if redis.call('HGET', KEYS[4], ARGV[2]) == ARGV[1] then
  redis.call('HDEL', KEYS[4], ARGV[2])
end
local previous = redis.call('HGET', KEYS[2], ARGV[2])
if previous then
  redis.call('ZREM', KEYS[1], previous)
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[4])
return 1
`;

/** Sheds one queued member under backpressure. ARGV: member, id. */
export const EVICT_SCRIPT = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then
  return 0
end
if redis.call('HGET', KEYS[2], ARGV[2]) == ARGV[1] then
  redis.call('HDEL', KEYS[2], ARGV[2])
end
return 1
`;

/**
 * Redis-backed {@link RetryQueue}.
 *
 * Mirrors {@link MemoryRetryQueue}'s design, which is the specification for
 * this interface: two collections keyed by record ID (queued and in-flight),
 * so `ack`/`nack` resolve a record in O(1) instead of scanning. Redis holds
 * each collection as a sorted set (scored by `nextRetryAt` / in-flight expiry)
 * plus a companion hash mapping record ID to that set's member, and every
 * transition between them runs as one Lua script.
 *
 * Upgrading from a build without the index hashes needs no migration: queued
 * records still dequeue by score, and each one populates the index as it moves.
 * In-flight records written by the older build have no index entry, so they are
 * simply reclaimed when their visibility timeout expires rather than acked -
 * a delayed redelivery, never a loss.
 */
export class RedisRetryQueue implements RetryQueue {
  readonly key: string;
  readonly inFlightKey: string;
  /** Record ID -> queued sorted-set member. */
  readonly indexKey: string;
  /** Record ID -> in-flight sorted-set member. */
  readonly inFlightIndexKey: string;

  private readonly client: RedisLike;
  private readonly now: () => number;
  private readonly visibilityTimeoutMs: number;

  constructor(client: RedisLike, options: RedisRetryQueueOptions = {}) {
    this.client = client;
    this.now = options.now ?? Date.now;
    this.visibilityTimeoutMs = Math.max(
      1,
      Math.floor(options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS),
    );

    const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
    this.key = `${keyPrefix}:retry-queue:${queueName}`;
    this.inFlightKey = `${this.key}:in-flight`;
    this.indexKey = `${this.key}:index`;
    this.inFlightIndexKey = `${this.inFlightKey}:index`;
  }

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);
    await this.run(ENQUEUE_SCRIPT, [record.id, record.nextRetryAt, JSON.stringify(record)]);
  }

  async dequeue(nowMs = this.now()): Promise<RetryRecord | null> {
    await this.reclaimExpiredInFlight(nowMs);

    const members = await this.client.zrangebyscore(
      this.key,
      "-inf",
      nowMs,
      "LIMIT",
      0,
      SCAN_BATCH_SIZE,
    );

    for (const member of members) {
      const record = this.parseRecord(member);
      if (!record) {
        // Unparseable member: drop it rather than wedging the queue head.
        await this.client.zrem(this.key, member);
        continue;
      }

      const claimed = await this.run(CLAIM_SCRIPT, [
        member,
        record.id,
        nowMs + this.visibilityTimeoutMs,
      ]);
      if (claimed === 0) continue; // another worker won the race

      return record;
    }

    return null;
  }

  async ack(recordId: string): Promise<void> {
    await this.run(ACK_SCRIPT, [recordId]);
  }

  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const member = await this.client.hget(this.inFlightIndexKey, recordId);
    if (!member) return;

    const record = this.parseRecord(member);
    if (!record) {
      // Nothing useful to requeue, but the in-flight entry must not linger.
      await this.run(ACK_SCRIPT, [recordId]);
      return;
    }

    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    const nextRetryAt = this.now() + delayMs;
    const requeued: RetryRecord = { ...record, nextRetryAt };

    await this.run(REQUEUE_SCRIPT, [
      recordId,
      nextRetryAt,
      JSON.stringify(requeued),
      // Guards against the member having changed since the read above.
      member,
    ]);
  }

  async evictNewest(): Promise<RetryRecord | null> {
    const [member] = await this.client.zrevrange(this.key, 0, 0);
    if (!member) return null;

    const record = this.parseRecord(member);
    const evicted = await this.run(EVICT_SCRIPT, [member, record?.id ?? ""]);
    if (evicted === 0) return null;

    return record;
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
        SCAN_BATCH_SIZE,
      );
      if (expiredMembers.length === 0) return;

      let progressed = false;
      for (const member of expiredMembers) {
        const record = this.parseRecord(member);
        if (!record) {
          await this.client.zrem(this.inFlightKey, member);
          progressed = true;
          continue;
        }

        const reclaimed = await this.run(RECLAIM_SCRIPT, [
          member,
          record.id,
          nowMs,
          JSON.stringify({ ...record, nextRetryAt: nowMs }),
        ]);
        if (reclaimed === 1) progressed = true;
      }

      // Every member in this batch was claimed by someone else in the
      // meantime; re-reading the same head would spin forever.
      if (!progressed) return;
    }
  }

  /** Runs one of the scripts above against this queue's four keys. */
  private async run(script: string, args: RedisValue[]): Promise<number> {
    const result = await this.client.eval(
      script,
      4,
      this.key,
      this.indexKey,
      this.inFlightKey,
      this.inFlightIndexKey,
      ...args,
    );
    return Number(result ?? 0);
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
