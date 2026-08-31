import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import { RedisRetryQueue, type RedisLike, type RetryRecord } from "../src/index.js";
import {
  ACK_SCRIPT,
  CLAIM_SCRIPT,
  ENQUEUE_SCRIPT,
  EVICT_SCRIPT,
  RECLAIM_SCRIPT,
  REQUEUE_SCRIPT,
} from "../src/RedisRetryQueue.js";

type SortedSetMember = {
  score: number;
  member: string;
  sequence: number;
};

class MockRedis implements RedisLike {
  private readonly sets = new Map<string, SortedSetMember[]>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private sequence = 0;
  /** How many script invocations this fake has served, for atomicity assertions. */
  evalCalls = 0;
  /** Range reads served, to prove ack/nack no longer scan. */
  rangeCalls = 0;

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
    this.rangeCalls += 1;
    const minScore = this.parseScore(min);
    const maxScore = this.parseScore(max);
    const limitIndex = args.findIndex((arg) => String(arg).toUpperCase() === "LIMIT");
    const offset = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 0) : 0;
    const count = limitIndex >= 0 ? Number(args[limitIndex + 2] ?? Infinity) : Infinity;

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

  hget(key: string, field: string): string | null {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  hset(key: string, field: string, value: string): number {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const isNew = !hash.has(field);
    hash.set(field, value);
    this.hashes.set(key, hash);
    return isNew ? 1 : 0;
  }

  hdel(key: string, field: string): number {
    return this.hashes.get(key)?.delete(field) ? 1 : 0;
  }

  hlen(key: string): number {
    return this.hashes.get(key)?.size ?? 0;
  }

  /**
   * Executes the queue's Lua scripts.
   *
   * Redis runs a script to completion before serving anything else; this fake
   * gets the same property for free, because JavaScript never interleaves
   * another call in the middle of a synchronous body. Dispatching on the
   * exported script constants also means a test fails if the queue starts
   * issuing a script this fake does not know about.
   */
  eval(script: string, numKeys: number, ...keysAndArgs: Array<number | string>): number {
    this.evalCalls += 1;

    const keys = keysAndArgs.slice(0, numKeys).map(String);
    const argv = keysAndArgs.slice(numKeys).map(String);
    const [queueKey, indexKey, inFlightKey, inFlightIndexKey] = keys as [
      string,
      string,
      string,
      string,
    ];

    if (script === ENQUEUE_SCRIPT) {
      const [id, score, member] = argv as [string, string, string];
      const previous = this.hget(indexKey, id);
      if (previous !== null) this.zrem(queueKey, previous);
      this.zadd(queueKey, Number(score), member);
      this.hset(indexKey, id, member);
      return 1;
    }

    if (script === CLAIM_SCRIPT) {
      const [member, id, expiresAt] = argv as [string, string, string];
      if (this.zrem(queueKey, member) === 0) return 0;
      if (this.hget(indexKey, id) === member) this.hdel(indexKey, id);
      this.zadd(inFlightKey, Number(expiresAt), member);
      this.hset(inFlightIndexKey, id, member);
      return 1;
    }

    if (script === ACK_SCRIPT) {
      const [id] = argv as [string];
      const member = this.hget(inFlightIndexKey, id);
      if (member === null) return 0;
      this.zrem(inFlightKey, member);
      this.hdel(inFlightIndexKey, id);
      return 1;
    }

    if (script === REQUEUE_SCRIPT) {
      const [id, score, newMember, expectedMember] = argv as [string, string, string, string];
      const member = this.hget(inFlightIndexKey, id);
      if (member === null || member !== expectedMember) return 0;
      if (this.zrem(inFlightKey, member) === 0) {
        this.hdel(inFlightIndexKey, id);
        return 0;
      }
      this.hdel(inFlightIndexKey, id);
      const previous = this.hget(indexKey, id);
      if (previous !== null) this.zrem(queueKey, previous);
      this.zadd(queueKey, Number(score), newMember);
      this.hset(indexKey, id, newMember);
      return 1;
    }

    if (script === RECLAIM_SCRIPT) {
      const [member, id, score, newMember] = argv as [string, string, string, string];
      if (this.zrem(inFlightKey, member) === 0) return 0;
      if (this.hget(inFlightIndexKey, id) === member) this.hdel(inFlightIndexKey, id);
      const previous = this.hget(indexKey, id);
      if (previous !== null) this.zrem(queueKey, previous);
      this.zadd(queueKey, Number(score), newMember);
      this.hset(indexKey, id, newMember);
      return 1;
    }

    if (script === EVICT_SCRIPT) {
      const [member, id] = argv as [string, string];
      if (this.zrem(queueKey, member) === 0) return 0;
      if (this.hget(indexKey, id) === member) this.hdel(indexKey, id);
      return 1;
    }

    throw new Error("MockRedis.eval: unknown script");
  }

  /** Number of members in a set, for assertions about where a record lives. */
  count(key: string): number {
    return this.zcard(key);
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
    expect(await payments.dequeue(1_000)).toEqual(retryRecord({ id: "payments-retry" }));
  });

  it("re-emerges dequeued records after visibility timeout when not acked", async () => {
    const queue = new RedisRetryQueue(new MockRedis(), {
      visibilityTimeoutMs: 1_000,
    });
    const record = retryRecord({ id: "visibility", nextRetryAt: 1_000 });

    expect(await queue.enqueue(record)).toBeUndefined();
    expect(await queue.dequeue(1_000)).toEqual(record);
    expect(await queue.dequeue(1_999)).toBeNull();
    expect(await queue.dequeue(2_000)).toEqual({
      ...record,
      nextRetryAt: 2_000,
    });
  });

  it("removes in-flight records on ack", async () => {
    const queue = new RedisRetryQueue(new MockRedis(), {
      visibilityTimeoutMs: 500,
    });
    const record = retryRecord({ id: "ack-me", nextRetryAt: 100 });

    expect(await queue.enqueue(record)).toBeUndefined();
    expect(await queue.dequeue(100)).toEqual(record);

    await queue.ack("ack-me");

    expect(await queue.dequeue(1_000)).toBeNull();
  });

  it("nack requeues in-flight records using the provided delay", async () => {
    let now = 1_000;
    const queue = new RedisRetryQueue(new MockRedis(), {
      now: () => now,
      visibilityTimeoutMs: 5_000,
    });
    const record = retryRecord({ id: "nack-me", nextRetryAt: 1_000 });

    expect(await queue.enqueue(record)).toBeUndefined();
    expect(await queue.dequeue(1_000)).toEqual(record);

    now = 1_100;
    await queue.nack("nack-me", 500);

    expect(await queue.dequeue(1_599)).toBeNull();
    expect(await queue.dequeue(1_600)).toEqual({
      ...record,
      nextRetryAt: 1_600,
    });
  });
});

describe("RedisRetryQueue: O(1) resolution and index hygiene", () => {
  async function fillInFlight(queue: RedisRetryQueue, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await queue.enqueue(retryRecord({ id: `retry-${i}`, nextRetryAt: 100 }));
    }
    for (let i = 0; i < count; i += 1) {
      await queue.dequeue(100);
    }
  }

  it("acks a record without reading the in-flight set, however deep it is", async () => {
    const redis = new MockRedis();
    const queue = new RedisRetryQueue(redis, { visibilityTimeoutMs: 10_000 });

    // Deeper than the old scan's 10-member batch, so an offset walk would need
    // several round-trips to reach the last record.
    await fillInFlight(queue, 25);

    const rangeCallsBefore = redis.rangeCalls;
    const evalCallsBefore = redis.evalCalls;

    await queue.ack("retry-24");

    // One HGET-driven script, no range read at all - the cost no longer grows
    // with in-flight depth.
    expect(redis.rangeCalls).toBe(rangeCallsBefore);
    expect(redis.evalCalls).toBe(evalCallsBefore + 1);
  });

  it("nacks the last-enqueued record with a single script call", async () => {
    const redis = new MockRedis();
    const queue = new RedisRetryQueue(redis, { now: () => 1_000, visibilityTimeoutMs: 10_000 });

    await fillInFlight(queue, 25);

    const rangeCallsBefore = redis.rangeCalls;
    const evalCallsBefore = redis.evalCalls;

    await queue.nack("retry-24", 500);

    expect(redis.rangeCalls).toBe(rangeCallsBefore);
    expect(redis.evalCalls).toBe(evalCallsBefore + 1);
    expect(await queue.dequeue(1_500)).toEqual(retryRecord({ id: "retry-24", nextRetryAt: 1_500 }));
  });

  it("leaves no index entry behind on ack, nack, reclaim or eviction", async () => {
    const redis = new MockRedis();
    const queue = new RedisRetryQueue(redis, { now: () => 5_000, visibilityTimeoutMs: 1_000 });
    const indexes = () => redis.hlen(queue.indexKey) + redis.hlen(queue.inFlightIndexKey);

    // ack
    await queue.enqueue(retryRecord({ id: "acked", nextRetryAt: 100 }));
    await queue.dequeue(100);
    await queue.ack("acked");
    expect(indexes()).toBe(0);

    // nack, then ack the requeued copy
    await queue.enqueue(retryRecord({ id: "nacked", nextRetryAt: 100 }));
    await queue.dequeue(100);
    await queue.nack("nacked", 0);
    await queue.dequeue(5_000);
    await queue.ack("nacked");
    expect(indexes()).toBe(0);

    // reclaim, then ack the reclaimed copy
    await queue.enqueue(retryRecord({ id: "reclaimed", nextRetryAt: 100 }));
    await queue.dequeue(100);
    await queue.dequeue(10_000); // visibility expired -> reclaimed and re-claimed
    await queue.ack("reclaimed");
    expect(indexes()).toBe(0);

    // eviction
    await queue.enqueue(retryRecord({ id: "evicted", nextRetryAt: 9_000 }));
    expect(await queue.evictNewest()).toEqual(retryRecord({ id: "evicted", nextRetryAt: 9_000 }));
    expect(indexes()).toBe(0);
    expect(await queue.size()).toBe(0);
  });
});

describe("RedisRetryQueue: atomicity", () => {
  /** Wraps a client so the `n`th script call dies, standing in for the process dying mid-transition. */
  function crashOnEval(inner: MockRedis, failOnCall: number): RedisLike {
    let calls = 0;
    return {
      zadd: inner.zadd.bind(inner),
      zrangebyscore: inner.zrangebyscore.bind(inner),
      zrevrange: inner.zrevrange.bind(inner),
      zrem: inner.zrem.bind(inner),
      zcard: inner.zcard.bind(inner),
      hget: inner.hget.bind(inner),
      eval: (script: string, numKeys: number, ...args: Array<number | string>) => {
        calls += 1;
        if (calls === failOnCall) throw new Error("connection reset mid-reclaim");
        return inner.eval(script, numKeys, ...args);
      },
    };
  }

  it("leaves a reclaimed record in exactly one set when the process dies mid-reclaim", async () => {
    const redis = new MockRedis();
    const seed = new RedisRetryQueue(redis, { visibilityTimeoutMs: 1_000 });

    await seed.enqueue(retryRecord({ id: "crash-me", nextRetryAt: 100 }));
    await seed.dequeue(100); // now in-flight, expires at 1_100

    // A fresh queue over a crashing client: the reclaim script is the first
    // call it makes, and it never completes.
    const crashing = new RedisRetryQueue(crashOnEval(redis, 1), { visibilityTimeoutMs: 1_000 });
    await expect(crashing.dequeue(2_000)).rejects.toThrow("connection reset mid-reclaim");

    // Redis runs a script to completion or not at all, so the record is still
    // whole in the in-flight set - not lost from both.
    expect(redis.count(seed.key) + redis.count(seed.inFlightKey)).toBe(1);

    // ...and a healthy worker still recovers it.
    const recovered = await seed.dequeue(2_000);
    expect(recovered).toEqual(retryRecord({ id: "crash-me", nextRetryAt: 2_000 }));
  });

  it("keeps every record in exactly one place under interleaved ack, nack and reclaim", async () => {
    const redis = new MockRedis();
    let now = 1_000;
    const options = { now: () => now, visibilityTimeoutMs: 500 };

    // Two workers over one Redis, as in production.
    const workerA = new RedisRetryQueue(redis, options);
    const workerB = new RedisRetryQueue(redis, options);

    const ids = Array.from({ length: 12 }, (_, i) => `r-${i}`);
    for (const id of ids) {
      await workerA.enqueue(retryRecord({ id, nextRetryAt: 1_000 }));
    }

    // Both workers pull concurrently, in rounds, until the queue is drained.
    // A worker that loses every race in its batch gets null and polls again -
    // what matters is that no record is ever handed to two workers or skipped.
    const claimedIds: string[] = [];
    while ((await workerA.size()) > 0) {
      const claimed = await Promise.all([
        workerA.dequeue(now),
        workerB.dequeue(now),
        workerA.dequeue(now),
        workerB.dequeue(now),
      ]);
      for (const record of claimed) {
        if (record) claimedIds.push(record.id);
      }
    }
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(new Set(claimedIds)).toEqual(new Set(ids));
    expect(await workerA.size()).toBe(0);

    // Interleave: ack a third, nack a third, let a third time out.
    await Promise.all(
      ids.map((id, i) => {
        if (i % 3 === 0) return workerA.ack(id);
        if (i % 3 === 1) return workerB.nack(id, 0);
        return Promise.resolve();
      }),
    );

    now = 2_000; // past the visibility timeout for whatever is left in flight
    const drained: string[] = [];
    for (;;) {
      const record = await workerB.dequeue(now);
      if (!record) break;
      drained.push(record.id);
      await workerB.ack(record.id);
    }

    // The acked third is gone; the nacked and timed-out thirds each came back
    // exactly once.
    expect(drained.sort()).toEqual(ids.filter((_, i) => i % 3 !== 0).sort());
    expect(await workerA.size()).toBe(0);
    expect(redis.count(workerA.inFlightKey)).toBe(0);
    expect(redis.hlen(workerA.indexKey) + redis.hlen(workerA.inFlightIndexKey)).toBe(0);
  });
});
