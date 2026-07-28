import { getTaxonomyForApi } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await getTaxonomyForApi();

  return Response.json({
    taxonomy: result.taxonomy,
    taxonomyHash: result.taxonomyHash,
    servedFrom: result.meta.servedFrom,
    stale: result.meta.stale,
    asOfLedger: result.meta.asOfLedger,
  });
}
