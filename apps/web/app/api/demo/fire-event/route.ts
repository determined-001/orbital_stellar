import { clientIp } from "../../../../lib/demo-limits";
import { checkFireEventRateLimit } from "../../../../lib/fireEventRateLimit";
import { fireDemoEvent, DemoEmitterNotConfiguredError } from "../../../../lib/fireDemoEvent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const isProduction = process.env.VERCEL_ENV === "production" ||
    (process.env.VERCEL_ENV === undefined && process.env.NODE_ENV === "production");

  if (isProduction && !process.env.DEMO_EMITTER_CONTRACT_ID) {
    console.error("[fire-event] DEMO_EMITTER_CONTRACT_ID is required in production.");
    return Response.json(
      { error: "not_configured", message: "Demo emitter is not configured." },
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
    if (!result) {
      console.warn("[fire-event] Demo emitter returned no result; it may not be configured.");
      return Response.json(
        { error: "not_configured", message: "Demo emitter is not configured." },
        { status: 503 },
      );
    }
    return Response.json(result);
  } catch (err) {
    if (err instanceof DemoEmitterNotConfiguredError) {
      console.warn("[fire-event] Demo emitter not configured:", err.message);
      return Response.json({ error: "not_configured", message: err.message }, { status: 503 });
    }

    const errorMessage = err instanceof Error ? err.message : "Failed to invoke the demo-emitter contract.";
    if (/manifest/i.test(errorMessage)) {
      console.error("[fire-event] Demo emitter manifest error:", errorMessage);
      return Response.json({ error: "manifest_error", message: errorMessage }, { status: 502 });
    }

    console.error("[fire-event] Unhandled error invoking demo emitter:", err);
    return Response.json(
      { error: "fire_event_failed", message: errorMessage },
      { status: 502 },
    );
  }
}
