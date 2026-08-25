import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEMO_LIMITS, acquireStream, checkWebhookCooldown, clientIp } from "@/lib/demo-limits";

function ipHeaders(ip: string): Request {
  return new Request("https://orbital.example/api/events/G", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

/** Each test gets a distinct IP - the limiter state is module-level. */
let counter = 0;
const freshIp = () => `198.51.100.${++counter % 250}${Math.floor(counter / 250)}`;

describe("acquireStream", () => {
  it("permits the configured number of concurrent streams per IP", () => {
    const ip = freshIp();
    const first = acquireStream(ip);
    expect(first.ok).toBe(true);

    const second = acquireStream(ip);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.body.reason).toBe("per_ip_stream_limit");
      expect(second.body.upgradeUrl).toBe(DEMO_LIMITS.upgradeUrl);
    }
  });

  it("frees the slot on release", () => {
    const ip = freshIp();
    const slot = acquireStream(ip);
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;

    slot.release();
    expect(acquireStream(ip).ok).toBe(true);
  });

  it("is idempotent on repeated release, so a double teardown cannot mint slots", () => {
    const ip = freshIp();
    const slot = acquireStream(ip);
    if (!slot.ok) throw new Error("expected slot");

    // Both the abort listener and the session timer call close() in the SSE
    // routes; the guard there is belt, this is braces.
    slot.release();
    slot.release();
    slot.release();

    const a = acquireStream(ip);
    expect(a.ok).toBe(true);
    expect(acquireStream(ip).ok).toBe(false);
  });

  it("tracks IPs independently", () => {
    const a = freshIp();
    const b = freshIp();
    expect(acquireStream(a).ok).toBe(true);
    expect(acquireStream(b).ok).toBe(true);
  });
});

describe("checkWebhookCooldown", () => {
  afterEach(() => vi.useRealTimers());

  it("allows the first call and rejects an immediate second", () => {
    const ip = freshIp();
    expect(checkWebhookCooldown(ip).ok).toBe(true);

    const second = checkWebhookCooldown(ip);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.body.reason).toBe("rate_limit");
      expect(second.body.retryAfterMs).toBeGreaterThan(0);
      expect(second.body.retryAfterMs).toBeLessThanOrEqual(DEMO_LIMITS.webhookCooldownMs);
    }
  });

  it("allows again once the cooldown has elapsed", () => {
    vi.useFakeTimers();
    const ip = freshIp();
    expect(checkWebhookCooldown(ip).ok).toBe(true);
    expect(checkWebhookCooldown(ip).ok).toBe(false);

    vi.advanceTimersByTime(DEMO_LIMITS.webhookCooldownMs + 1);
    expect(checkWebhookCooldown(ip).ok).toBe(true);
  });
});

describe("limits are keyed on the trusted identity", () => {
  it("a rotating forged XFF cannot escape the webhook cooldown", () => {
    const real = freshIp();
    // Every request comes from the same real peer; only the forged prefix moves.
    const requests = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map(
      (forged) =>
        new Request("https://orbital.example/api/webhook-sample", {
          headers: { "x-vercel-forwarded-for": real, "x-forwarded-for": forged },
        }),
    );

    const results = requests.map((req) => checkWebhookCooldown(clientIp(req)).ok);
    expect(results).toEqual([true, false, false]);
  });

  it("resolves the same bucket for the same peer regardless of forged headers", () => {
    const real = freshIp();
    expect(clientIp(ipHeaders(real))).toBe(real);
  });
});
