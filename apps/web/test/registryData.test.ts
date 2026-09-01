import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getTaxonomy } from "@/app/api/registry-data/taxonomy/route";
import { GET as getLabels } from "@/app/api/registry-data/labels/route";
import { __resetRegistryDataCacheForTests } from "@/lib/registryData";

function req(url: string, ip: string): NextRequest {
  return new NextRequest(url, { headers: { "x-vercel-forwarded-for": ip } });
}

/** Each test gets a distinct IP - the rate limiter state is module-level. */
let counter = 0;
const freshIp = () => `198.51.100.${++counter % 250}${Math.floor(counter / 250)}`;

afterEach(() => __resetRegistryDataCacheForTests());

describe("GET /api/registry-data/taxonomy", () => {
  it("returns the taxonomy records with a stale-while-revalidate Cache-Control header", async () => {
    const res = await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", freshIp()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=3600");

    const body = (await res.json()) as { records: unknown[] };
    expect(body.records.length).toBeGreaterThan(0);
  });

  it("filters by category", async () => {
    const ip = freshIp();
    const all = await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", ip));
    const { records } = (await all.json()) as { records: { category: string }[] };
    const category = records[0]?.category;
    expect(category).toBeDefined();

    const filtered = await getTaxonomy(
      req(`https://orbital.example/api/registry-data/taxonomy?category=${category}`, freshIp()),
    );
    const { records: filteredRecords } = (await filtered.json()) as { records: { category: string }[] };
    expect(filteredRecords.length).toBeGreaterThan(0);
    expect(filteredRecords.every((r) => r.category === category)).toBe(true);
  });

  it("returns an empty set for a category that doesn't exist", async () => {
    const res = await getTaxonomy(
      req("https://orbital.example/api/registry-data/taxonomy?category=does-not-exist", freshIp()),
    );
    const body = (await res.json()) as { records: unknown[] };
    expect(body.records).toEqual([]);
  });
});

describe("GET /api/registry-data/labels", () => {
  it("returns the label records with a stale-while-revalidate Cache-Control header", async () => {
    const res = await getLabels(req("https://orbital.example/api/registry-data/labels", freshIp()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=3600");

    const body = (await res.json()) as { records: unknown[] };
    expect(body.records.length).toBeGreaterThan(0);
  });

  it("filters by network", async () => {
    const res = await getLabels(
      req("https://orbital.example/api/registry-data/labels?network=mainnet", freshIp()),
    );
    const { records } = (await res.json()) as { records: { network: string }[] };
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.network === "mainnet")).toBe(true);
  });

  it("filters by tag", async () => {
    const all = await getLabels(req("https://orbital.example/api/registry-data/labels", freshIp()));
    const { records } = (await all.json()) as { records: { tags: string[] }[] };
    const tag = records[0]?.tags[0];
    expect(tag).toBeDefined();

    const filtered = await getLabels(
      req(`https://orbital.example/api/registry-data/labels?tag=${tag}`, freshIp()),
    );
    const { records: filteredRecords } = (await filtered.json()) as { records: { tags: string[] }[] };
    expect(filteredRecords.length).toBeGreaterThan(0);
    expect(filteredRecords.every((r) => r.tags.includes(tag as string))).toBe(true);
  });

  it("filters by category", async () => {
    const all = await getLabels(req("https://orbital.example/api/registry-data/labels", freshIp()));
    const { records } = (await all.json()) as { records: { category: string }[] };
    const category = records[0]?.category;
    expect(category).toBeDefined();

    const filtered = await getLabels(
      req(`https://orbital.example/api/registry-data/labels?category=${category}`, freshIp()),
    );
    const { records: filteredRecords } = (await filtered.json()) as { records: { category: string }[] };
    expect(filteredRecords.length).toBeGreaterThan(0);
    expect(filteredRecords.every((r) => r.category === category)).toBe(true);
  });

  it("returns an empty set (not an error) for a filter value that matches nothing", async () => {
    const res = await getLabels(
      req("https://orbital.example/api/registry-data/labels?network=does-not-exist", freshIp()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: unknown[] };
    expect(body.records).toEqual([]);
  });
});

describe("registry-data rate limiting", () => {
  it("allows the first request and rejects an immediate second from the same IP", async () => {
    const ip = freshIp();
    const first = await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", ip));
    expect(first.status).toBe(200);

    const second = await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", ip));
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();

    const body = (await second.json()) as { error: string; reason: string };
    expect(body.error).toBe("demo_limit_reached");
    expect(body.reason).toBe("rate_limit");
  });

  it("tracks the taxonomy and labels endpoints under independent per-IP budgets", async () => {
    // Regression: these two used to share one cooldown bucket keyed by IP
    // alone, so calling one right after the other from the same IP always
    // 429'd the second - exactly what /explore does on every search (spec +
    // labels fetched concurrently). Cooldowns are now keyed by (ip, endpoint).
    const ip = freshIp();
    const first = await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", ip));
    expect(first.status).toBe(200);

    const second = await getLabels(req("https://orbital.example/api/registry-data/labels", ip));
    expect(second.status).toBe(200);
  });

  it("does not 429 either request when a page fires spec and labels concurrently from one IP", async () => {
    // Mirrors /explore's actual request pattern: Promise.all over two
    // different registry-data endpoints from the same IP in the same tick.
    const ip = freshIp();
    const [taxonomyRes, labelsRes] = await Promise.all([
      getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", ip)),
      getLabels(req("https://orbital.example/api/registry-data/labels", ip)),
    ]);

    expect(taxonomyRes.status).toBe(200);
    expect(labelsRes.status).toBe(200);
  });

  it("tracks IPs independently", async () => {
    const a = freshIp();
    const b = freshIp();
    expect((await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", a))).status).toBe(
      200,
    );
    expect((await getTaxonomy(req("https://orbital.example/api/registry-data/taxonomy", b))).status).toBe(
      200,
    );
  });
});
