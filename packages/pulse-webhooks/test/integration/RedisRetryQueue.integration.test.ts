import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisRetryQueue, type RetryRecord } from "../../src/index.js";
import { MinimalRedisClient } from "./redisClient.js";

/**
 * Exercises the queue's Lua against a real Redis, which is the only way to
 * check the scripts themselves rather than a fake standing in for them.
 *
 *   podman run -d --rm -p 6379:6379 docker.io/library/redis:7-alpine
 *   INTEGRATION_TESTS=true pnpm --filter @orbital-stellar/pulse-webhooks test:integration
 */
describe("RedisRetryQueue against a real Redis", () => {
  const shouldRun = process.env.INTEGRATION_TESTS === "true";

  if (!shouldRun) {
    it("skipping RedisRetryQueue integration tests (INTEGRATION_TESTS is not true)", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const url = process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6379";
  let client: MinimalRedisClient;
  let queue: RedisRetryQueue;
  let now = 1_000;

  const record = (id: string, nextRetryAt: number): RetryRecord => ({
    id,
    event: { id },
    url: "https://example.com/hook",
    attempt: 1,
    nextRetryAt,
  });

  beforeAll(async () => {
    client = await MinimalRedisClient.connect(url);
    queue = new RedisRetryQueue(client, {
      keyPrefix: "orbital:it",
      queueName: `redis-retry-${Date.now()}`,
      now: () => now,
      visibilityTimeoutMs: 500,
    });
  });

  afterAll(async () => {
    if (client) {
      await client.del(queue.key, queue.indexKey, queue.inFlightKey, queue.inFlightIndexKey);
      await client.close();
    }
  });

  it("round-trips enqueue -> dequeue -> ack with the index cleaned up", async () => {
    await queue.enqueue(record("ack-me", 1_000));
    expect(await queue.size()).toBe(1);

    expect(await queue.dequeue(1_000)).toEqual(record("ack-me", 1_000));
    expect(await client.hlen(queue.inFlightIndexKey)).toBe(1);

    await queue.ack("ack-me");
    expect(await client.zcard(queue.inFlightKey)).toBe(0);
    expect(await client.hlen(queue.inFlightIndexKey)).toBe(0);
    expect(await client.hlen(queue.indexKey)).toBe(0);
  });

  it("requeues on nack and reclaims after the visibility timeout", async () => {
    now = 2_000;
    await queue.enqueue(record("nack-me", 2_000));
    expect(await queue.dequeue(2_000)).toEqual(record("nack-me", 2_000));

    await queue.nack("nack-me", 100);
    expect(await client.zcard(queue.inFlightKey)).toBe(0);
    expect(await queue.dequeue(2_099)).toBeNull();
    expect(await queue.dequeue(2_100)).toEqual(record("nack-me", 2_100));

    // Left in flight past its visibility timeout -> reclaimed, not lost.
    expect(await queue.dequeue(2_700)).toEqual(record("nack-me", 2_700));
    await queue.ack("nack-me");
    expect(await client.hlen(queue.indexKey)).toBe(0);
    expect(await client.hlen(queue.inFlightIndexKey)).toBe(0);
  });

  it("hands a record to exactly one of several concurrent workers", async () => {
    now = 3_000;
    const ids = Array.from({ length: 8 }, (_, i) => `race-${i}`);
    for (const id of ids) await queue.enqueue(record(id, 3_000));

    const workers = [client, client, client].map(
      (c) =>
        new RedisRetryQueue(c, {
          keyPrefix: "orbital:it",
          queueName: queue.key.split(":").pop()!,
          now: () => now,
          visibilityTimeoutMs: 500,
        }),
    );

    const claimed: string[] = [];
    while ((await queue.size()) > 0) {
      const results = await Promise.all(workers.map((w) => w.dequeue(now)));
      for (const result of results) if (result) claimed.push(result.id);
    }

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(new Set(claimed)).toEqual(new Set(ids));

    for (const id of ids) await queue.ack(id);
    expect(await client.zcard(queue.inFlightKey)).toBe(0);
    expect(await client.hlen(queue.inFlightIndexKey)).toBe(0);
  });

  it("evicts the newest queued record and drops its index entry", async () => {
    now = 4_000;
    await queue.enqueue(record("keep", 4_000));
    await queue.enqueue(record("shed", 9_000));

    expect(await queue.evictNewest()).toEqual(record("shed", 9_000));
    expect(await queue.size()).toBe(1);
    expect(await client.hlen(queue.indexKey)).toBe(1);

    expect(await queue.dequeue(4_000)).toEqual(record("keep", 4_000));
    await queue.ack("keep");
    expect(await client.hlen(queue.indexKey)).toBe(0);
  });
});
