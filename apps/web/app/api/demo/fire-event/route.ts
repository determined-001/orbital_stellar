import { clientIp } from "@/lib/demo-limits";
import { checkFireEventRateLimit } from "@/lib/fireEventRateLimit";
import {
  fireDemoEvent,
  DemoEmitterNotConfiguredError,
  getDemoEmitterConfig,
} from "@/lib/fireDemoEvent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Fail before the rate-limit round trip, and log the reason: a deployed
  // misconfiguration used to be silent and looked like "feature off" (#1030).
  const config = getDemoEmitterConfig();
  if (!config.configured) {
    console.warn(`[fire-event] demo emitter ${config.status}: ${config.reason ?? "no detail"}`);
    return Response.json(
      {
        error: "not_configured",
        status: config.status,
        message: "Demo emitter is not configured.",
      },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  const cooldown = await checkFireEventRateLimit(ip);
  if (!cooldown.ok) {
    if (cooldown.status === 429) {
      return Response.json(cooldown.body, {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
      });
    }
    return Response.json(cooldown.body, { status: 503 });
  }

  try {
    const result = await fireDemoEvent();
    return Response.json(result);
  } catch (err) {
    if (err instanceof DemoEmitterNotConfiguredError) {
      console.warn("[fire-event] demo emitter not configured:", err.message);
      return Response.json({ error: "not_configured", message: err.message }, { status: 503 });
    }
    console.error("[fire-event] failed to invoke the demo-emitter contract:", err);
    return Response.json(
      {
        error: "fire_event_failed",
        message: err instanceof Error ? err.message : "Failed to invoke the demo-emitter contract.",
      },
      { status: 502 },
    );
  }
}
