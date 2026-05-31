import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "@orbital/pulse-core";
import {
  RedisRetryQueue,
  type RedisLike,
  type RetryRecord,
} from "../src/index.js";

type SortedSetMember = {
  score: number;
  member: string;
  sequence: number;
};

class MockRedis implements RedisLike {
  private readonly sets = new Map<string, SortedSetMember[]>();
  private sequence = 0;

  zadd(key: string, score: number, member: string): number {
    const set = this.sets.get(key) ?? [];
    const existing = set.find((entry) => entry.member === member);

    if (existing) {
      existing.score = score;
      return 0;
    }

    set.push({ score, member, sequence: this.sequence++ });
    this.sets.set(key, set);
    return 1;
  }

  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ...args: Array<number | string>
  ): string[] {
    const minScore = this.parseScore(min);
    const maxScore = this.parseScore(max);
    const limitIndex = args.findIndex(
      (arg) => String(arg).toUpperCase() === "LIMIT",
    );
    const offset = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 0) : 0;
    const count =
      limitIndex >= 0 ? Number(args[limitIndex + 2] ?? Infinity) : Infinity;

    return [...(this.sets.get(key) ?? [])]
      .filter((entry) => entry.score >= minScore && entry.score <= maxScore)
      .sort((a, b) => a.score - b.score || a.sequence - b.sequence)
      .slice(offset, Number.isFinite(count) ? offset + count : undefined)
      .map((entry) => entry.member);
  }

  zrevrange(key: string, start: number, stop: number): string[] {
    return [...(this.sets.get(key) ?? [])]
      .sort((a, b) => b.score - a.score || b.sequence - a.sequence)
      .slice(start, stop + 1)
      .map((entry) => entry.member);
  }

  zrem(key: string, member: string): number {
    const set = this.sets.get(key) ?? [];
    const next = set.filter((entry) => entry.member !== member);
    this.sets.set(key, next);
    return set.length === next.length ? 0 : 1;
  }

  zcard(key: string): number {
    return this.sets.get(key)?.length ?? 0;
  }

  private parseScore(score: number | string): number {
    if (score === "-inf") return Number.NEGATIVE_INFINITY;
    if (score === "+inf" || score === "inf") return Number.POSITIVE_INFINITY;
    return Number(score);
  }
}

const event: NormalizedEvent = {
  type: "payment.received",
  to: "GDEST",
  from: "GSRC",
  amount: "10",
  asset: "XLM",
  timestamp: "2026-04-26T12:00:00.000Z",
  raw: { id: "evt_1" },
};

function retryRecord(overrides: Partial<RetryRecord> = {}): RetryRecord {
  return {
    id: "retry-1",
    event,
    url: "https://example.com/webhooks/stellar",
    attempt: 2,
    nextRetryAt: 1_000,
    lastError: "HTTP 503",
    ...overrides,
  };
}

describe("RedisRetryQueue", () => {
  it("uses the documented key prefix convention", () => {
    const queue = new RedisRetryQueue(new MockRedis(), {
      keyPrefix: "orbital:test",
      queueName: "payments",
    });

    expect(queue.key).toBe("orbital:test:retry-queue:payments");
  });

  it("round-trips due records from the Redis sorted set", async () => {
    const queue = new RedisRetryQueue(new MockRedis());
    const first = retryRecord({ id: "retry-1", nextRetryAt: 1_000 });
    const second = retryRecord({ id: "retry-2", nextRetryAt: 500 });

    await queue.enqueue(first);
    await queue.enqueue(second);

    expect(await queue.size()).toBe(2);
    expect(await queue.dequeue(1_000)).toEqual(second);
    expect(await queue.dequeue(1_000)).toEqual(first);
    expect(await queue.dequeue(1_000)).toBeNull();
    expect(await queue.size()).toBe(0);
  });

  it("does not dequeue records before nextRetryAt", async () => {
    const queue = new RedisRetryQueue(new MockRedis());
    const record = retryRecord({ nextRetryAt: 2_000 });

    await queue.enqueue(record);

    expect(await queue.dequeue(1_999)).toBeNull();
    expect(await queue.size()).toBe(1);
    expect(await queue.dequeue(2_000)).toEqual(record);
  });

  it("evicts the newest scheduled retry", async () => {
    const queue = new RedisRetryQueue(new MockRedis());
    const oldRetry = retryRecord({ id: "old", nextRetryAt: 1_000 });
    const newestRetry = retryRecord({ id: "newest", nextRetryAt: 5_000 });

    await queue.enqueue(oldRetry);
    await queue.enqueue(newestRetry);

    expect(await queue.evictNewest()).toEqual(newestRetry);
    expect(await queue.size()).toBe(1);
    expect(await queue.dequeue(5_000)).toEqual(oldRetry);
  });

  it("keeps queued retries available across queue instances", async () => {
    const redis = new MockRedis();
    const beforeRestart = new RedisRetryQueue(redis, {
      keyPrefix: "orbital:test",
      queueName: "restart",
    });
    const afterRestart = new RedisRetryQueue(redis, {
      keyPrefix: "orbital:test",
      queueName: "restart",
    });
    const inFlightRetry = retryRecord({
      id: "in-flight",
      attempt: 3,
      nextRetryAt: 1_500,
    });

    await beforeRestart.enqueue(inFlightRetry);

    expect(await afterRestart.size()).toBe(1);
    expect(await afterRestart.dequeue(1_500)).toEqual(inFlightRetry);
  });

  it("keeps different queue names isolated under the same prefix", async () => {
    const redis = new MockRedis();
    const payments = new RedisRetryQueue(redis, {
      keyPrefix: "orbital:test",
      queueName: "payments",
    });
    const audits = new RedisRetryQueue(redis, {
      keyPrefix: "orbital:test",
      queueName: "audits",
    });

    await payments.enqueue(retryRecord({ id: "payments-retry" }));

    expect(await audits.dequeue(1_000)).toBeNull();
    expect(await payments.dequeue(1_000)).toEqual(
      retryRecord({ id: "payments-retry" }),
    );
  });
});
