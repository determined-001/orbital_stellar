import { createHash } from "node:crypto";
import { fullJitterBackoffMs } from "@orbital-stellar/pulse-core";
import { clientIp } from "@/lib/demo-limits";

const WINDOW_MS = 60_000;
const PER_IP_LIMIT = 120;
const PER_KEY_LIMIT = 600;
const CHAIN_READ_LIMIT = 300;
const MAX_URL_LENGTH = 2_048;
const MAX_QUERY_PARAMETERS = 10;
const MAX_QUERY_VALUE_LENGTH = 256;
const CACHE_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;

type Bucket = { startedAt: number; count: number };
type Cached = { body: unknown; etag: string; cachedAt: number };

const ipBuckets = new Map<string, Bucket>();
const keyBuckets = new Map<string, Bucket>();
const chainReads = new Map<string, Bucket>();
const cache = new Map<string, Cached>();

function take(map: Map<string, Bucket>, id: string, limit: number, now: number): boolean {
  const bucket = map.get(id);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    map.set(id, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function retryAfterSeconds(now: number): number {
  return Math.max(
    1,
    Math.ceil((WINDOW_MS + fullJitterBackoffMs(1, 250, 1_000) - (now % WINDOW_MS)) / 1_000),
  );
}

function limitedResponse(message: string, retryAfter: number): Response {
  return Response.json(
    { error: "rate_limit_exceeded", message, retryAfterSeconds: retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

function validateQuery(req: Request): Response | null {
  if (req.url.length > MAX_URL_LENGTH) {
    return Response.json(
      { error: "request_too_large", message: "URL exceeds 2048 characters" },
      { status: 414 },
    );
  }
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].length > MAX_QUERY_PARAMETERS) {
    return Response.json(
      { error: "too_many_query_parameters", message: "Too many query parameters" },
      { status: 400 },
    );
  }
  for (const value of params.values()) {
    if (value.length > MAX_QUERY_VALUE_LENGTH) {
      return Response.json(
        { error: "query_value_too_large", message: "Query value exceeds 256 characters" },
        { status: 400 },
      );
    }
  }
  const limit = Number(params.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Response.json(
      { error: "invalid_limit", message: "limit must be an integer from 1 to 100" },
      { status: 400 },
    );
  }
  return null;
}

function etag(body: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
}

function response(
  body: unknown,
  tag: string,
  servedFrom: "live" | "stale",
  req: Request,
): Response {
  if (req.headers.get("if-none-match") === tag && servedFrom === "live") {
    return new Response(null, {
      status: 304,
      headers: { ETag: tag, "Cache-Control": "public, max-age=30, stale-while-revalidate=300" },
    });
  }
  const payload = servedFrom === "stale" ? { data: body, servedFrom } : body;
  return Response.json(payload, {
    headers: {
      ETag: tag,
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
      ...(servedFrom === "stale" ? { Warning: '110 - "Response is stale"' } : {}),
    },
  });
}

export async function registryRead(
  req: Request,
  cacheKey: string,
  load: () => Promise<unknown>,
): Promise<Response> {
  const invalidQuery = validateQuery(req);
  if (invalidQuery) return invalidQuery;

  const now = Date.now();
  const ip = clientIp(req);
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization") ?? "";
  if (!take(ipBuckets, ip, PER_IP_LIMIT, now))
    return limitedResponse("Per-IP registry read limit exceeded", retryAfterSeconds(now));
  if (apiKey && !take(keyBuckets, apiKey, PER_KEY_LIMIT, now))
    return limitedResponse("API-key registry read limit exceeded", retryAfterSeconds(now));

  const cached = cache.get(cacheKey);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS)
    return response(cached.body, cached.etag, "live", req);

  const minute = Math.floor(now / WINDOW_MS).toString();
  if (!take(chainReads, minute, CHAIN_READ_LIMIT, now)) {
    if (cached && now - cached.cachedAt < STALE_TTL_MS)
      return response(cached.body, cached.etag, "stale", req);
    return limitedResponse(
      "Registry chain-read budget exhausted and no stale response is available",
      retryAfterSeconds(now),
    );
  }

  const body = await load();
  if (body instanceof Response) return body;
  const tag = etag(body);
  cache.set(cacheKey, { body, etag: tag, cachedAt: now });
  return response(body, tag, "live", req);
}

export function __resetRegistryReadPolicyForTests(): void {
  ipBuckets.clear();
  keyBuckets.clear();
  chainReads.clear();
  cache.clear();
}

export function __expireRegistryCacheForTests(): void {
  for (const [key, value] of cache) {
    cache.set(key, { ...value, cachedAt: Date.now() - CACHE_TTL_MS - 1 });
  }
}
