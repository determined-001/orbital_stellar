import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkFireEventRateLimit,
  __resetFireEventRateLimitForTests,
} from "@/lib/fireEventRateLimit";

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;

describe("checkFireEventRateLimit", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of UPSTASH_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    __resetFireEventRateLimitForTests();
  });

  afterEach(() => {
    for (const key of UPSTASH_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    __resetFireEventRateLimitForTests();
  });

  it("fails CLOSED with 503 when Upstash is not configured", async () => {
    // POST /api/demo/fire-event signs a real testnet transaction with a funded
    // key. A misconfigured deploy must refuse to fire rather than run without
    // a shared limiter - an in-memory fallback would be per-instance on
    // serverless and would not bound anything.
    const result = await checkFireEventRateLimit("203.0.113.9");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("rate_limiter_not_configured");
  });

  it("fails closed when only one of the two variables is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    __resetFireEventRateLimitForTests();

    const result = await checkFireEventRateLimit("203.0.113.9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("stays closed for every caller, not just the first", async () => {
    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      const result = await checkFireEventRateLimit(ip);
      expect(result.ok).toBe(false);
    }
  });
});
