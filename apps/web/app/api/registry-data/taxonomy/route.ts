import { NextRequest, NextResponse } from "next/server";
import { checkRegistryDataCooldown, clientIp } from "@/lib/demo-limits";
import { getTaxonomyRecords, REGISTRY_DATA_CACHE_CONTROL } from "@/lib/registryData";

/**
 * GET /api/registry-data/taxonomy - the open taxonomy dataset, optionally
 * filtered by `category`. Taxonomy records carry no `network` or `tag`
 * field (see `data/taxonomy.json`), so those two query params - meaningful
 * on `/api/registry-data/labels` - are accepted but have no effect here.
 */
export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const cooldown = checkRegistryDataCooldown(ip, "taxonomy");
  if (!cooldown.ok) {
    return NextResponse.json(cooldown.body, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  const category = request.nextUrl.searchParams.get("category");

  let records = getTaxonomyRecords();
  if (category) {
    records = records.filter((record) => record.category === category);
  }

  return NextResponse.json(
    { records },
    { headers: { "Cache-Control": REGISTRY_DATA_CACHE_CONTROL } },
  );
}
