import "server-only";

import { Redis } from "@upstash/redis";

/**
 * Single cached Upstash Redis client for every demo rate/concurrency limiter
 * (fire-event, SSE stream concurrency, webhook-sample cooldown, docs search
 * cooldown). One client per process instead of one per limiter avoids opening
 * a redundant REST connection pool per feature.
 *
 * Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. Returns null
 * when either is unset so callers can fail closed.
 */
let client: Redis | null | undefined;

export function getUpstashRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return null;
  }

  client = new Redis({ url, token });
  return client;
}

/** Test helper — clears the cached client between cases. */
export function __resetUpstashRedisForTests(): void {
  client = undefined;
}
