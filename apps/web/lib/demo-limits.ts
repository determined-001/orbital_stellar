// In-memory rate / concurrency tracking for the public marketing demo.
// Sized to keep Vercel costs bounded - this is a sandbox, not a service.
//
// Fire-event limiting is NOT here — see fireEventRateLimit.ts (Upstash Redis).
// In-memory Maps are per-instance on serverless and cannot protect the faucet.

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

const activeStreams = new Map<string, number>();
const lastWebhookAt = new Map<string, number>();

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

export function acquireStream(
  ip: string,
): { ok: true; release: () => void } | { ok: false; body: StreamLimitEnvelope } {
  const count = activeStreams.get(ip) ?? 0;
  if (count >= DEMO_LIMITS.perIpStreams) {
    return {
      ok: false,
      body: {
        error: "demo_limit_reached",
        upgradeUrl: DEMO_LIMITS.upgradeUrl,
        reason: "per_ip_stream_limit",
        message:
          "You already have a demo stream open. Sign up for Orbital Cloud for concurrent streams.",
      },
    };
  }
  activeStreams.set(ip, count + 1);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const next = (activeStreams.get(ip) ?? 1) - 1;
      if (next <= 0) activeStreams.delete(ip);
      else activeStreams.set(ip, next);
    },
  };
}

export function checkWebhookCooldown(
  ip: string,
): { ok: true } | { ok: false; body: RateLimitEnvelope } {
  const now = Date.now();
  const last = lastWebhookAt.get(ip);
  if (last !== undefined && now - last < DEMO_LIMITS.webhookCooldownMs) {
    const retryAfterMs = DEMO_LIMITS.webhookCooldownMs - (now - last);
    return {
      ok: false,
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
  lastWebhookAt.set(ip, now);
  return { ok: true };
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
