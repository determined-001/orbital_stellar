import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEMO_LIMITS, acquireStream, checkWebhookCooldown, clientIp } from "@/lib/demo-limits";
import { __resetUpstashRedisForTests } from "@/lib/upstashRedis";
import { fakeRedisStore } from "./stubs/fakeUpstashRedis";

vi.mock("@upstash/redis", async () => {
  const mod = await import("./stubs/fakeUpstashRedis");
  return { Redis: mod.FakeUpstashRedis };
});

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;

function configureUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  __resetUpstashRedisForTests();
}

function ipHeaders(ip: string): Request {
  return new Request("https://orbital.example/api/events/G", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

/** Each test gets a distinct IP - the limiter state is a shared Redis key. */
let counter = 0;
const freshIp = () => `198.51.100.${++counter % 250}${Math.floor(counter / 250)}`;

describe("acquireStream / checkWebhookCooldown", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of UPSTASH_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    fakeRedisStore.reset();
    __resetUpstashRedisForTests();
  });

  afterEach(() => {
    for (const key of UPSTASH_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    __resetUpstashRedisForTests();
  });

  describe("fail-closed when Upstash is not configured", () => {
    it("acquireStream refuses with 503 rather than granting an unbounded slot", async () => {
      const result = await acquireStream(freshIp());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(503);
      expect(result.body.error).toBe("rate_limiter_not_configured");
    });

    it("checkWebhookCooldown refuses with 503 rather than allowing every call", async () => {
      const result = await checkWebhookCooldown(freshIp());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(503);
      expect(result.body.error).toBe("rate_limiter_not_configured");
    });

    it("acquireStream stays closed for every caller, not just the first", async () => {
      for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
        const result = await acquireStream(ip);
        expect(result.ok).toBe(false);
      }
    });
  });

  describe("with Upstash configured", () => {
    beforeEach(() => configureUpstash());

    describe("acquireStream", () => {
      it("permits the configured number of concurrent streams per IP", async () => {
        const ip = freshIp();
        const first = await acquireStream(ip);
        expect(first.ok).toBe(true);

        const second = await acquireStream(ip);
        expect(second.ok).toBe(false);
        if (!second.ok) {
          expect(second.status).toBe(429);
          if (second.status === 429) {
            expect(second.body.reason).toBe("per_ip_stream_limit");
            expect(second.body.upgradeUrl).toBe(DEMO_LIMITS.upgradeUrl);
          }
        }
      });

      it("frees the slot on release", async () => {
        const ip = freshIp();
        const slot = await acquireStream(ip);
        expect(slot.ok).toBe(true);
        if (!slot.ok) return;

        await slot.release();
        expect((await acquireStream(ip)).ok).toBe(true);
      });

      it("is idempotent on repeated release, so a double teardown cannot mint slots", async () => {
        const ip = freshIp();
        const slot = await acquireStream(ip);
        if (!slot.ok) throw new Error("expected slot");

        // Both the abort listener and the session timer call close() in the
        // SSE routes; the guard there is belt, this is braces.
        await slot.release();
        await slot.release();
        await slot.release();

        const a = await acquireStream(ip);
        expect(a.ok).toBe(true);
        expect((await acquireStream(ip)).ok).toBe(false);
      });

      it("tracks IPs independently", async () => {
        const a = freshIp();
        const b = freshIp();
        expect((await acquireStream(a)).ok).toBe(true);
        expect((await acquireStream(b)).ok).toBe(true);
      });

      it("regression: a release on a different instance than the one that acquired still frees the slot", async () => {
        // Simulate two serverless instances sharing the same Redis but not the
        // same process: the second "instance" starts with a fresh cached
        // client (forcing reconstruction) while the backing store persists.
        const ip = freshIp();
        const slot = await acquireStream(ip);
        expect(slot.ok).toBe(true);
        if (!slot.ok) return;

        // Instance B comes up cold.
        __resetUpstashRedisForTests();

        await slot.release();

        // Instance C observes the freed slot.
        __resetUpstashRedisForTests();
        expect((await acquireStream(ip)).ok).toBe(true);
      });
    });

    describe("checkWebhookCooldown", () => {
      it("allows the first call and rejects an immediate second", async () => {
        const ip = freshIp();
        expect((await checkWebhookCooldown(ip)).ok).toBe(true);

        const second = await checkWebhookCooldown(ip);
        expect(second.ok).toBe(false);
        if (!second.ok && second.status === 429) {
          expect(second.body.reason).toBe("rate_limit");
          expect(second.body.retryAfterMs).toBeGreaterThan(0);
          expect(second.body.retryAfterMs).toBeLessThanOrEqual(DEMO_LIMITS.webhookCooldownMs);
        }
      });
    });

    describe("limits are keyed on the trusted identity", () => {
      it("a rotating forged XFF cannot escape the webhook cooldown", async () => {
        const real = freshIp();
        // Every request comes from the same real peer; only the forged prefix moves.
        const requests = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map(
          (forged) =>
            new Request("https://orbital.example/api/webhook-sample", {
              headers: { "x-vercel-forwarded-for": real, "x-forwarded-for": forged },
            }),
        );

        const results: boolean[] = [];
        for (const req of requests) {
          results.push((await checkWebhookCooldown(clientIp(req))).ok);
        }
        expect(results).toEqual([true, false, false]);
      });

      it("resolves the same bucket for the same peer regardless of forged headers", () => {
        const real = freshIp();
        expect(clientIp(ipHeaders(real))).toBe(real);
      });
    });
  });
});
