import { StrKey } from "@orbital-stellar/pulse-core";
import { getEngine } from "@/lib/engine";

/**
 * Server-Sent Events bridge: the engine runs on the server, the browser gets a
 * stream. `useStellarEvent` on the client connects straight to this route.
 *
 * Node runtime, not edge - the engine keeps a long-lived Horizon connection
 * and a file-backed cursor.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
): Promise<Response> {
  const { address } = await params;

  if (!StrKey.isValidEd25519PublicKey(address)) {
    return Response.json(
      { error: "invalid_address", message: "Not a valid Stellar public key" },
      { status: 400 },
    );
  }

  const engine = getEngine();
  const watcher = engine.subscribe(address);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        watcher.removeListener("*", onEvent);
        engine.unsubscribe(address);
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

      // Proxies and load balancers drop idle connections; a comment line every
      // ten seconds keeps the stream alive without emitting a fake event.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, 10_000);

      watcher.on("*", onEvent);
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
