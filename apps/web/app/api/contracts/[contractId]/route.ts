import { isContractAddress } from "@orbital-stellar/pulse-core";
import { getEngine } from "@/lib/engine";
import {
  DEMO_LIMITS,
  acquireStream,
  clientIp,
} from "@/lib/demo-limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const { contractId } = await params;

  if (!isContractAddress(contractId)) {
    return Response.json(
      { error: "invalid_contract_id", message: "Not a valid Soroban contract address" },
      { status: 400 }
    );
  }

  const ip = clientIp(req);
  const slot = acquireStream(ip);
  if (!slot.ok) {
    return Response.json(slot.body, { status: 429 });
  }

  const engine = getEngine();
  const subscriptionId = `contract:${contractId}`;
  const watcher = engine.subscribeContract(subscriptionId, {
    filters: [{ contractIds: [contractId] }],
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(sessionTimer);
        watcher.removeListener("*", onEvent);
        engine.unsubscribeContract(subscriptionId);
        slot.release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const onEvent = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          close();
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          close();
        }
      }, 10_000);

      const sessionTimer = setTimeout(() => {
        if (closed) return;
        const payload = JSON.stringify({
          error: "demo_limit_reached",
          reason: "session_expired",
          message: `Demo sessions are capped at ${DEMO_LIMITS.streamDurationMs / 1000}s. Sign up for Orbital Cloud for persistent streams.`,
          upgradeUrl: DEMO_LIMITS.upgradeUrl,
        });
        try {
          controller.enqueue(
            encoder.encode(`event: session_expired\ndata: ${payload}\n\n`)
          );
        } catch {
          /* ignore */
        }
        close();
      }, DEMO_LIMITS.streamDurationMs);

      watcher.on("*", onEvent);
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
