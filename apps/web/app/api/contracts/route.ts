import { listRegisteredContracts } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await listRegisteredContracts();

  if (!result.ok) {
    const status = result.reason === "not_configured" ? 503 : 502;
    return Response.json({ error: result.reason, message: result.message }, { status });
  }

  return Response.json({ contracts: result.contracts, fetchedAt: result.fetchedAt });
}
