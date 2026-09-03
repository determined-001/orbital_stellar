import { getSpecStore, getVerdictStore } from "@/lib/registry";
import type { RegisteredSpec } from "@orbital-stellar/abi-registry";
import { validateSpec } from "@orbital-stellar/abi-registry";
import { registryRead } from "@/lib/registryReadPolicy";

export async function GET(req: Request) {
  return registryRead(req, "registry:specs", async () => {
    const specs = await getSpecStore().getAll();
    const verdicts = await getVerdictStore().getAll();
    const verdictMap = new Map(verdicts.map((v) => [v.contractId, v]));
    return specs.map((spec) => ({
      ...spec,
      latestVerdict: verdictMap.get(spec.contractId) ?? null,
    }));
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      contractId: string;
      spec: Record<string, unknown>;
      publisher?: string;
    };

    if (!body.contractId || !body.spec) {
      return Response.json(
        { error: "invalid_request", message: "contractId and spec are required" },
        { status: 400 },
      );
    }

    const validation = validateSpec(body.spec);
    if (!validation.valid) {
      return Response.json(
        { error: "invalid_spec", message: validation.errors.join("; ") },
        { status: 400 },
      );
    }

    const registered: RegisteredSpec = {
      contractId: body.contractId,
      spec: body.spec as RegisteredSpec["spec"],
      publisher: body.publisher,
      submittedAt: new Date().toISOString(),
    };

    await getSpecStore().register(registered);

    return Response.json(registered, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: "registration_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
