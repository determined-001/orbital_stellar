import { getVerdictStore } from "@/lib/registry";
import { registryRead } from "@/lib/registryReadPolicy";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contractId = searchParams.get("contractId");

  const store = getVerdictStore();

  if (contractId) {
    return registryRead(req, `registry:verdict:${contractId}`, async () => {
      const verdict = await store.getLatest(contractId);
      if (!verdict) {
        return Response.json(
          { error: "not_found", message: "No verdict for this contract" },
          { status: 404 },
        );
      }
      return verdict;
    });
  }

  return registryRead(req, "registry:verdicts", () => store.getAll());
}
