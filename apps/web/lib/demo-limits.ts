import "server-only";

import { getUpstashRedis } from "@/lib/upstashRedis";

// Rate / concurrency tracking for the public marketing demo, backed by the
// same shared Upstash Redis as fireEventRateLimit.ts. Sized to keep Vercel
// costs bounded - this is a sandbox, not a service.
//
// apps/web runs on serverless: an in-memory Map is per-instance and the
// effective ceiling becomes (configured limit) x (live instances). Both
// limiters below fail closed (503) when Redis is unconfigured, same as
// fireEventRateLimit.ts — a misconfigured deploy must not silently wave
// requests through. Callers decide per endpoint whether "unavailable" should
// block the request or be treated as best-effort; see the route handlers.

export const DEMO_LIMITS = {
  /** One concurrent SSE stream per IP. */
  perIpStreams: 1,
  /** A stream is closed after this many ms; client is told to upgrade. */
  streamDurationMs: 25_000,
  /** One webhook-sample signing call per IP every N ms. */
  webhookCooldownMs: 20_000,
  /**
   * One "fire test event" on-chain invocation per IP every N ms.
   * Enforced via shared Upstash Redis in `fireEventRateLimit.ts`.
   */
  fireEventCooldownMs: 10_000,
  /** Upgrade URL surfaced in 429 responses. */
  upgradeUrl: "/cloud",
} as const;

type EnvelopeBase = { error: "demo_limit_reached"; upgradeUrl: string };

export type StreamLimitEnvelope = EnvelopeBase & {
  reason: "per_ip_stream_limit";
  message: string;
};

export type RateLimitEnvelope = EnvelopeBase & {
  reason: "rate_limit";
  message: string;
  retryAfterMs: number;
};

export type LimitEnvelope = StreamLimitEnvelope | RateLimitEnvelope;

/** Returned by both limiters below when Redis is unconfigured. */
export type RateLimiterUnavailableEnvelope = {
  error: "rate_limiter_not_configured";
  message: string;
};

export type StreamAcquireResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; status: 429; body: StreamLimitEnvelope }
  | { ok: false; status: 503; body: RateLimiterUnavailableEnvelope };

export type CooldownResult =
  | { ok: true }
  | { ok: false; status: 429; body: RateLimitEnvelope }
  | { ok: false; status: 503; body: RateLimiterUnavailableEnvelope };

function unavailableBody(feature: string): RateLimiterUnavailableEnvelope {
  return {
    error: "rate_limiter_not_configured",
    message: `${feature} is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).`,
  };
}

/**
 * Per-IP SSE concurrency, enforced via a shared Redis counter so the limit
 * holds across serverless instances instead of resetting per instance.
 *
 * Not a `Ratelimit.slidingWindow` — this tracks *concurrently open* streams,
 * not a request rate, so it needs an increment/decrement pair rather than a
 * window. The counter carries a TTL slightly longer than the max stream
 * duration so a crashed instance (release() never called) cannot leak a slot
 * forever.
 */
export async function acquireStream(ip: string): Promise<StreamAcquireResult> {
  const redis = getUpstashRedis();
  if (!redis) {
    return { ok: false, status: 503, body: unavailableBody("SSE stream concurrency limiting") };
  }

  const key = `orbital:demo:stream:${ip}`;
  const ttlSeconds = Math.ceil(DEMO_LIMITS.streamDurationMs / 1000) + 10;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  if (count > DEMO_LIMITS.perIpStreams) {
    // Undo the increment we just made — this request is not getting a slot.
    await redis.decr(key);
    return {
      ok: false,
      status: 429,
      body: {
        error: "demo_limit_reached",
        upgradeUrl: DEMO_LIMITS.upgradeUrl,
        reason: "per_ip_stream_limit",
        message:
          "You already have a demo stream open. Sign up for Orbital Cloud for concurrent streams.",
      },
    };
  }

  let released = false;
  return {
    ok: true,
    release: async () => {
      if (released) return;
      released = true;
      const next = await redis.decr(key);
      if (next <= 0) await redis.del(key);
    },
  };
}

/**
 * Hard per-IP cooldown (not a sliding window): the first call within the
 * window wins, backed by a Redis `SET ... NX PX` so only one instance can
 * "win" the cooldown regardless of which instance serves a given request.
 */
export async function checkWebhookCooldown(ip: string): Promise<CooldownResult> {
  const redis = getUpstashRedis();
  if (!redis) {
    return { ok: false, status: 503, body: unavailableBody("Webhook cooldown limiting") };
  }

  const key = `orbital:demo:webhook-cooldown:${ip}`;
  const acquired = await redis.set(key, "1", { nx: true, px: DEMO_LIMITS.webhookCooldownMs });
  if (acquired === "OK") {
    return { ok: true };
  }

  const retryAfterMs = Math.max(1, await redis.pttl(key));
  return {
    ok: false,
    status: 429,
    body: {
      error: "demo_limit_reached",
      upgradeUrl: DEMO_LIMITS.upgradeUrl,
      reason: "rate_limit",
      message:
        "Webhook signing is rate-limited on the demo. Sign up for Orbital Cloud for production use.",
      retryAfterMs,
    },
  };
}

/**
 * Number of trusted reverse proxies in front of this deployment, used to pick
 * which `X-Forwarded-For` segment is real. Unset (or 0) means "we do not know",
 * and XFF is then ignored entirely.
 *
 * Every forwarding header is client-settable unless something in front of us
 * overwrites it. On Vercel `x-vercel-forwarded-for` provides that guarantee for
 * free. Anywhere else the operator has to tell us the topology - guessing is
 * what made this spoofable in the first place.
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw) return 0;
  const hops = Number.parseInt(raw, 10);
  return Number.isInteger(hops) && hops > 0 ? hops : 0;
}

/**
 * Best-effort caller identity for the per-IP demo limits.
 *
 * Trust order:
 *  1. `x-vercel-forwarded-for` - stamped by Vercel's edge from the real socket
 *     peer and overwritten on every request, so a client cannot forge it.
 *  2. `x-forwarded-for`, but ONLY when `TRUSTED_PROXY_HOPS` says how many
 *     proxies append to it. We then read the Nth segment from the right - the
 *     one our own infrastructure added - and never the client-controlled prefix.
 *  3. Otherwise `"unknown"`.
 *
 * Note `x-real-ip` is deliberately NOT consulted: it is a single value with no
 * append semantics, so a directly-reachable deployment cannot tell an
 * nginx-set header from a client-set one.
 */
/**
 * Warn once per process when we cannot identify callers at all.
 *
 * Collapsing everyone into one bucket is the right direction for abuse, but it
 * also means `perIpStreams: 1` becomes a global limit: on a non-Vercel deploy
 * without `TRUSTED_PROXY_HOPS`, the entire internet shares one SSE slot and one
 * webhook-sample call per 20s, and the demo looks broken to everybody. That is
 * a deployment mistake worth surfacing rather than absorbing silently.
 */
let warnedAboutUnknownIp = false;

function warnUnidentifiedOnce(): void {
  if (warnedAboutUnknownIp) return;
  warnedAboutUnknownIp = true;
  console.warn(
    "[demo-limits] No x-vercel-forwarded-for and TRUSTED_PROXY_HOPS is unset, so " +
      "every caller shares one rate-limit bucket. On Vercel this should never happen. " +
      "Anywhere else, set TRUSTED_PROXY_HOPS to the number of proxies in front of this " +
      "deployment, or the per-IP demo limits act as global limits.",
  );
}

/** Test helper - clears the once-per-process warning latch between cases. */
export function __resetUnidentifiedWarningForTests(): void {
  warnedAboutUnknownIp = false;
}

export function clientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel;

  const hops = trustedProxyHops();
  if (hops > 0) {
    const segments = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);
    // Anything the client prepended sits to the LEFT of our proxies' entries.
    const trusted = segments[segments.length - hops];
    if (trusted) return trusted;
    // Fewer segments than configured hops means the header did not traverse
    // the proxy chain we were promised. Treat it as unidentified, not as truth.
  }

  // Deliberately a single shared bucket rather than a per-request unique value:
  // callers we cannot identify must collectively share one budget. Over-limiting
  // anonymous traffic is the safe failure direction - handing each unidentified
  // request its own key would silently disable every limit that uses this, which
  // is precisely the bug this function used to have.
  warnUnidentifiedOnce();
  return "unknown";
}
