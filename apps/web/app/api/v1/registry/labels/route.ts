import { NextRequest, NextResponse } from "next/server";
import { getCachedLabels, getCachedLedgerSequence } from "@/lib/hostedRegistryApi";
import type { HostedApiEnvelope } from "@/lib/hostedRegistryApi";
import type { LabelRecord } from "@/lib/registryData";

/**
 * GET /api/v1/registry/labels - the open entity-label dataset (issue #915),
 * optionally filtered by `network`, `tag` (single-tag membership against
 * the record's `tags` array), and `category`. See taxonomy/route.ts for why
 * `servedFrom` is "static" while `asOfLedger` is still populated.
 */
export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network");
  const tag = request.nextUrl.searchParams.get("tag");
  const category = request.nextUrl.searchParams.get("category");

  const [{ value: records, stale }, { value: asOfLedger }] = await Promise.all([
    getCachedLabels(),
    getCachedLedgerSequence(),
  ]);

  let filtered = records;
  if (network) filtered = filtered.filter((r) => r.network === network);
  if (tag) filtered = filtered.filter((r) => r.tags.includes(tag));
  if (category) filtered = filtered.filter((r) => r.category === category);

  const body: HostedApiEnvelope<LabelRecord[]> = {
    data: filtered,
    servedFrom: "static",
    asOfLedger,
    stale,
  };
  return NextResponse.json(body);
}
