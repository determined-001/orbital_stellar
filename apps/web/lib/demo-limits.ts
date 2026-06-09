// In-memory rate / concurrency tracking for the public marketing demo.
// Sized to keep Vercel costs bounded — this is a sandbox, not a service.

export const DEMO_LIMITS = {
  /** One concurrent SSE stream per IP. */
  perIpStreams: 1,
  /** A stream is closed after this many ms; client is told to upgrade. */
  streamDurationMs: 25_000,
  /** One webhook-sample signing call per IP every N ms. */
  webhookCooldownMs: 20_000,
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
  ip: string
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
  ip: string
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

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}
