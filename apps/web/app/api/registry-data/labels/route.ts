import { NextRequest, NextResponse } from "next/server";
import { checkRegistryDataCooldown, clientIp } from "@/lib/demo-limits";
import { getLabelRecords, REGISTRY_DATA_CACHE_CONTROL } from "@/lib/registryData";

/**
 * GET /api/registry-data/labels - the open entity-label dataset, optionally
 * filtered by `network`, `tag` (single-tag membership against the record's
 * `tags` array), and `category`.
 */
export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const cooldown = checkRegistryDataCooldown(ip, "labels");
  if (!cooldown.ok) {
    return NextResponse.json(cooldown.body, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  const network = request.nextUrl.searchParams.get("network");
  const tag = request.nextUrl.searchParams.get("tag");
  const category = request.nextUrl.searchParams.get("category");

  let records = getLabelRecords();
  if (network) {
    records = records.filter((record) => record.network === network);
  }
  if (tag) {
    records = records.filter((record) => record.tags.includes(tag));
  }
  if (category) {
    records = records.filter((record) => record.category === category);
  }

  return NextResponse.json(
    { records },
    { headers: { "Cache-Control": REGISTRY_DATA_CACHE_CONTROL } },
  );
}
