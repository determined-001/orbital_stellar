import { EventEngine, type CursorStoreLike } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";
import type { Server } from "node:http";
import { createReceiver } from "./receiver.js";
import { createCursorStore, type StarterConfig } from "./config.js";

/**
 * Wires the whole composition together and, importantly, takes it apart again.
 *
 * The shutdown path is the part worth copying: on SIGTERM the engine is
 * stopped *and awaited* before the process exits, so the cursor write for the
 * last delivered event completes. Exiting on the signal without waiting is how
 * a restart replays or, worse, skips events.
 */
export type StarterService = {
  stop: () => Promise<void>;
  /** Resolved once the HTTP receiver is listening. */
  port: number;
  cursorKind: "postgres" | "file";
};

export async function startService(config: StarterConfig): Promise<StarterService> {
  const { store, close: closeStore, kind } = await createCursorStore(config);

  const app = createReceiver({
    secret: config.webhookSecret,
    onEvent: (event) => {
      console.log(`[receiver] verified ${event.type} at ${event.timestamp}`);
    },
    onRejected: (reason, request) => {
      console.warn(`[receiver] rejected delivery from ${request.ip ?? "unknown"}: ${reason}`);
    },
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(config.port, () => resolve(listening));
  });

  const engine = new EventEngine({
    network: config.network,
    cursorStore: store as CursorStoreLike,
  });

  const deliveries: WebhookDelivery[] = [];
  for (const address of config.addresses) {
    const watcher = engine.subscribe(address);
    deliveries.push(
      new WebhookDelivery(watcher, {
        url: config.webhookUrl,
        secret: config.webhookSecret,
        retries: 3,
      }),
    );
  }

  engine.start();
  console.log(
    `[starter] watching ${config.addresses.length} address(es) on ${config.network}, ` +
      `cursor: ${kind}, receiver: http://127.0.0.1:${config.port}`,
  );

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;

    // Order matters: stop ingesting, let the engine flush its cursor, then
    // close the sockets and the pool.
    await engine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeStore();
    console.log("[starter] stopped cleanly");
  };

  return { stop, port: config.port, cursorKind: kind };
}

/** Installs SIGTERM/SIGINT handlers that shut down before exiting. */
export function installSignalHandlers(service: StarterService): () => void {
  const handler = (signal: NodeJS.Signals) => () => {
    console.log(`[starter] ${signal} received, shutting down`);
    void service.stop().then(
      () => process.exit(0),
      (error) => {
        console.error("[starter] shutdown failed", error);
        process.exit(1);
      },
    );
  };

  const onTerm = handler("SIGTERM");
  const onInt = handler("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);

  return () => {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
  };
}
