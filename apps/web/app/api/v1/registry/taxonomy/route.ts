import { NextRequest, NextResponse } from "next/server";
import { getCachedLedgerSequence, getCachedTaxonomy } from "@/lib/hostedRegistryApi";
import type { HostedApiEnvelope } from "@/lib/hostedRegistryApi";
import type { TaxonomyRecord } from "@/lib/registryData";

/**
 * GET /api/v1/registry/taxonomy - the open taxonomy dataset (issue #915),
 * optionally filtered by `category`. `servedFrom` is always "static": this
 * dataset is a build-time file (`data/taxonomy.json`), not chain-resolved -
 * `asOfLedger` still reports the current ledger for a consistent envelope
 * across every /v1/registry response, not because the data itself moves
 * with the chain.
 */
export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");

  const [{ value: records, stale }, { value: asOfLedger }] = await Promise.all([
    getCachedTaxonomy(),
    getCachedLedgerSequence(),
  ]);

  const filtered = category ? records.filter((r) => r.category === category) : records;

  const body: HostedApiEnvelope<TaxonomyRecord[]> = {
    data: filtered,
    servedFrom: "static",
    asOfLedger,
    stale,
  };
  return NextResponse.json(body);
}
