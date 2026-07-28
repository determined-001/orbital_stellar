import { getSpecForApi } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;
  const version = new URL(req.url).searchParams.get("version") ?? undefined;

  const result = await getSpecForApi(contractId, version);

  if (!result.ok) {
    const status =
      result.reason === "not_configured" ? 503 : result.reason === "invalid_contract_id" ? 400 : 404;
    return Response.json({ error: result.reason, message: result.message }, { status });
  }

  return Response.json({
    contractId,
    version: result.version,
    specHash: result.specHash,
    spec: result.spec,
    servedFrom: result.meta.servedFrom,
    stale: result.meta.stale,
    asOfLedger: result.meta.asOfLedger,
  });
}
