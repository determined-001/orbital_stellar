import { getVerdictStore } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contractId = searchParams.get("contractId");

  const store = getVerdictStore();

  if (contractId) {
    const verdict = await store.getLatest(contractId);
    if (!verdict) {
      return Response.json({ error: "not_found", message: "No verdict for this contract" }, { status: 404 });
    }
    return Response.json(verdict);
  }

  const verdicts = await store.getAll();
  return Response.json(verdicts);
}
