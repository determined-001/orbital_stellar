import type { ContractAddress, ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { getEngine } from "@/lib/engine";
import {
  describeContractEvent,
  DEMO_EMITTER_CONTRACT_ID,
  USDC_CONTRACT_ID,
} from "@/lib/demoContracts";

/**
 * Same SSE shape as `api/events/[address]`, but for the two contracts
 * `orbital.config.ts` generates types for (issue #908) rather than an
 * account. Each event is annotated with `describeContractEvent`'s output
 * using the real generated guards, so the client renders a classified line
 * instead of a bare event type.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const engine = getEngine();
  // `toContractAddress` isn't exported from this starter's pinned npm
  // `@orbital-stellar/pulse-core` (^0.1.0, predates it - see #1132); the
  // branded type still is, so a direct assertion stands in for it here.
  const watcher = engine.subscribeContract("demo-contracts", {
    filters: [
      {
        contractIds: [DEMO_EMITTER_CONTRACT_ID as ContractAddress, USDC_CONTRACT_ID as ContractAddress],
      },
    ],
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        watcher.removeListener("contract.emitted", onEvent);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const onEvent = (raw: { type: string }) => {
        if (closed) return;
        if (raw.type !== "contract.emitted") return;
        const event = raw as ContractEmittedEvent;
        const description = describeContractEvent(event);
        if (!description) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ description, at: event.timestamp })}\n\n`),
          );
        } catch {
          close();
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, 10_000);

      watcher.on("contract.emitted", onEvent);
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
