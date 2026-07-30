import { clientIp } from "@/lib/demo-limits";
import { checkFireEventRateLimit } from "@/lib/fireEventRateLimit";
import { fireDemoEvent, DemoEmitterNotConfiguredError } from "@/lib/fireDemoEvent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const cooldown = await checkFireEventRateLimit(ip);
  if (!cooldown.ok) {
    return Response.json(cooldown.body, {
      status: cooldown.status,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  try {
    const result = await fireDemoEvent();
    return Response.json(result);
  } catch (err) {
    if (err instanceof DemoEmitterNotConfiguredError) {
      return Response.json({ error: "not_configured", message: err.message }, { status: 503 });
    }
    return Response.json(
      {
        error: "fire_event_failed",
        message: err instanceof Error ? err.message : "Failed to invoke the demo-emitter contract.",
      },
      { status: 502 },
    );
  }
}
