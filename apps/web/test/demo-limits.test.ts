import { describe, it, expect, afterEach } from "vitest";
import { clientIp } from "@/lib/demo-limits";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://orbital.example/api/demo/fire-event", { headers });
}

/** Rotates a forged XFF prefix behind a fixed real peer and counts distinct buckets. */
function bucketsForForgedPrefixes(suffix: string): Set<string> {
  return new Set(
    ["1.2.3.1", "1.2.3.2", "1.2.3.3", "1.2.3.4", "1.2.3.5"].map((forged) =>
      clientIp(reqWith({ "x-forwarded-for": suffix ? `${forged}, ${suffix}` : forged })),
    ),
  );
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for over anything the client can set", () => {
    const req = reqWith({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "198.51.100.1",
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("regression (HIGH-2): rotating a forged XFF cannot mint new rate-limit buckets", () => {
    // Vercel present: the forged header is irrelevant.
    const onVercel = new Set(
      ["1.2.3.1", "1.2.3.2", "1.2.3.3"].map((forged) =>
        clientIp(reqWith({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": forged })),
      ),
    );
    expect(onVercel).toEqual(new Set(["203.0.113.7"]));

    // No platform header and no declared topology: everything collapses to one
    // shared bucket. Over-limiting, never under-limiting.
    expect(bucketsForForgedPrefixes("203.0.113.7")).toEqual(new Set(["unknown"]));
    expect(bucketsForForgedPrefixes("")).toEqual(new Set(["unknown"]));
  });

  it("ignores x-forwarded-for entirely when TRUSTED_PROXY_HOPS is unset", () => {
    // A single-segment XFF is indistinguishable from a client-set one, so the
    // old "just take the last segment" rule was still fully spoofable here.
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
  });

  it("ignores x-real-ip, which has no append semantics to verify", () => {
    expect(clientIp(reqWith({ "x-real-ip": "1.2.3.4" }))).toBe("unknown");
  });

  describe("with TRUSTED_PROXY_HOPS=1", () => {
    it("reads the segment our own proxy appended, not the client prefix", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
      expect(bucketsForForgedPrefixes("203.0.113.7")).toEqual(new Set(["203.0.113.7"]));
    });

    it("still separates genuinely distinct peers", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      expect(clientIp(reqWith({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
      expect(clientIp(reqWith({ "x-forwarded-for": "9.9.9.9, 203.0.113.8" }))).toBe("203.0.113.8");
    });

    it("tolerates whitespace and empty segments", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4 ,  , 203.0.113.7 ," }))).toBe(
        "203.0.113.7",
      );
    });
  });

  it("falls back to the shared bucket when XFF is shorter than the declared hops", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    // Only one segment, so the header never traversed the promised chain -
    // an attacker hitting the origin directly must not be believed.
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("treats a malformed TRUSTED_PROXY_HOPS as no trust at all", () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      process.env.TRUSTED_PROXY_HOPS = bad;
      expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("unknown");
    }
  });

  it("returns the shared bucket when no forwarding header is present", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
});
