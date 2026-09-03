import { describe, expect, it, beforeEach } from "vitest";
import {
  __expireRegistryCacheForTests,
  __resetRegistryReadPolicyForTests,
  registryRead,
} from "@/lib/registryReadPolicy";

const request = (ip: string, headers?: HeadersInit) =>
  new Request("https://orbital.example/api/registry/specs", {
    headers: { "x-vercel-forwarded-for": ip, ...headers },
  });

describe("registryRead", () => {
  beforeEach(() => __resetRegistryReadPolicyForTests());

  it("returns an ETag and honors conditional requests", async () => {
    const first = await registryRead(request("198.51.100.1"), "etag", async () => ({ ok: true }));
    const tag = first.headers.get("etag");
    expect(tag).toBeTruthy();

    const second = await registryRead(
      request("198.51.100.2", { "if-none-match": tag! }),
      "etag",
      async () => ({ ok: true }),
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("cache-control")).toContain("stale-while-revalidate");
  });

  it("limits both IPs and API keys with Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 121; i += 1) {
      last = await registryRead(
        request("198.51.100.3", { "x-api-key": `key-${i}` }),
        `ip-${i}`,
        async () => [],
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();

    __resetRegistryReadPolicyForTests();
    for (let i = 0; i < 601; i += 1) {
      last = await registryRead(
        request(`198.51.100.${i % 250}`, { "x-api-key": "shared" }),
        `key-${i}`,
        async () => [],
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
  });

  it("serves stale data after the chain-read ceiling", async () => {
    let reads = 0;
    await registryRead(request("198.51.100.4"), "stale", async () => {
      reads += 1;
      return { reads };
    });
    for (let i = 0; i < 300; i += 1) {
      await registryRead(request(`203.0.113.${i % 250}`), `unique-${i}`, async () => []);
    }
    __expireRegistryCacheForTests();
    const stale = await registryRead(request("198.51.100.4"), "stale", async () => {
      reads += 1;
      return { reads };
    });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ data: { reads: 1 }, servedFrom: "stale" });
  });

  it("rejects oversized and high-cardinality queries", async () => {
    const tooMany = await registryRead(
      new Request(
        `https://orbital.example/api/registry/specs?${Array.from({ length: 11 }, (_, i) => `q${i}=x`).join("&")}`,
      ),
      "query-many",
      async () => [],
    );
    expect(tooMany.status).toBe(400);

    const tooLarge = await registryRead(
      new Request(`https://orbital.example/api/registry/specs?q=${"x".repeat(257)}`),
      "query-large",
      async () => [],
    );
    expect(tooLarge.status).toBe(400);
  });
});
