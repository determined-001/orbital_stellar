import { resolve } from "path";
import { readFileSync } from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getDemoEmitterConfigStatus(): {
  configured: boolean;
  status: string;
  error?: string;
} {
  const contractId = process.env.DEMO_EMITTER_CONTRACT_ID?.trim();
  if (contractId) {
    return { configured: true, status: "configured" };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      configured: false,
      status: "not-configured",
      error: "DEMO_EMITTER_CONTRACT_ID is required in production",
    };
  }

  const manifestPath = resolve(process.cwd(), "..", "..", "contracts", "deployed.testnet.json");

  try {
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { emitterContractId?: string };
    if (manifest.emitterContractId) {
      return { configured: true, status: "configured-fallback" };
    }
    return { configured: false, status: "not-configured" };
  } catch (error) {
    console.warn(`Failed to read demo emitter manifest at ${manifestPath}:`, error);
    return {
      configured: false,
      status: "configuration-error",
      error: (error as Error).message,
    };
  }
}

export async function GET() {
  return Response.json(getDemoEmitterConfigStatus());
}
