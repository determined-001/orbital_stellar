import { getDemoEmitterConfig } from "@/lib/fireDemoEvent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // `status` distinguishes "not configured" from "configuration could not be
  // read", so a deployed misconfiguration is diagnosable from outside (#1030).
  return Response.json(getDemoEmitterConfig());
}
