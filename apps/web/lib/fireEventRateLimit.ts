import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { DEMO_LIMITS, type RateLimitEnvelope } from "@/lib/demo-limits";
import { getUpstashRedis, __resetUpstashRedisForTests } from "@/lib/upstashRedis";

/**
 * Shared rate limit for POST /api/demo/fire-event.
 *
 * apps/web runs on serverless, so an in-memory Map is per-instance and dies
 * with the instance — that cannot protect the funded testnet key. Upstash
 * Redis is the shared counter (same stack the maintainer pointed at for #892).
 *
 * Default: 1 fire / 10s per IP.
 *
 * Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. If unset, we
 * fail closed with 503 so a misconfigured deploy cannot open the faucet.
 */

let ratelimit: Ratelimit | null | undefined;

function getRatelimit(): Ratelimit | null {
  if (ratelimit !== undefined) return ratelimit;

  const redis = getUpstashRedis();
  if (!redis) {
    ratelimit = null;
    return null;
  }

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(1, `${DEMO_LIMITS.fireEventCooldownMs / 1000} s`),
    prefix: "orbital:demo:fire-event",
    analytics: false,
  });
  return ratelimit;
}

export type FireEventRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; body: RateLimitEnvelope }
  | {
      ok: false;
      status: 503;
      body: { error: "rate_limiter_not_configured"; message: string };
    };

/**
 * Enforce 1 fire / 10s per IP via Upstash. If Upstash is not configured,
 * refuse the request (503) so a misconfigured deploy cannot become an open
 * faucet against the funded invoker key.
 */
export async function checkFireEventRateLimit(ip: string): Promise<FireEventRateLimitResult> {
  const limiter = getRatelimit();
  if (!limiter) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "rate_limiter_not_configured",
        message:
          "Fire-event rate limiting is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Refusing to fire.",
      },
    };
  }

  const result = await limiter.limit(ip);
  if (result.success) {
    return { ok: true };
  }

  const retryAfterMs = Math.max(1_000, result.reset - Date.now());
  return {
    ok: false,
    status: 429,
    body: {
      error: "demo_limit_reached",
      upgradeUrl: DEMO_LIMITS.upgradeUrl,
      reason: "rate_limit",
      message:
        "Firing test events is rate-limited on the demo. Sign up for Orbital Cloud for production use.",
      retryAfterMs,
    },
  };
}

/** Test helper — clears the cached Ratelimit client between cases. */
export function __resetFireEventRateLimitForTests(): void {
  ratelimit = undefined;
  __resetUpstashRedisForTests();
}
