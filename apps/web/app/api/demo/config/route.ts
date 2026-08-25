import { isDemoEmitterConfigured } from "@/lib/fireDemoEvent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ configured: isDemoEmitterConfigured() });
}
