import { getRegistryHealth } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health = await getRegistryHealth();

  // Not configured is an expected pre-launch state, not an outage - 200.
  // Configured but unreachable is a real degradation - 503.
  const status = health.configured && !health.rpcReachable ? 503 : 200;

  return Response.json(health, { status });
}
