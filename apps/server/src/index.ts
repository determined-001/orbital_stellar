import express, { type Request, type Response } from "express";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookRegistry } from "./registry.js";
import { createRoutes } from "./routes.js";

// --- Environment validation ---

const VALID_NETWORKS = ["mainnet", "testnet"] as const;
type Network = (typeof VALID_NETWORKS)[number];

const rawNetwork = process.env.NETWORK;
if (!rawNetwork || !(VALID_NETWORKS as readonly string[]).includes(rawNetwork)) {
  console.error(
    `[server] Invalid or missing NETWORK env var: "${rawNetwork}". Must be "mainnet" or "testnet".`
  );
  process.exit(1);
}
const NETWORK = rawNetwork as Network;

const rawPort = process.env.PORT;
const parsedPort = rawPort ? parseInt(rawPort, 10) : NaN;
let PORT: number;
if (!rawPort || isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  console.warn(`[server] Invalid or missing PORT env var: "${rawPort}". Falling back to 3000.`);
  PORT = 3000;
} else {
  PORT = parsedPort;
}

// --- Bootstrap ---

// Track active SSE connections for clean shutdown
const activeSSEConnections = new Set<Response>();

const engine = new EventEngine({ network: NETWORK });
engine.start();
console.log(`[server] Event engine started on ${NETWORK}`);

const registry = new WebhookRegistry(engine);

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(createRoutes(registry, engine, activeSSEConnections));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", network: NETWORK });
});

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});

// --- Graceful shutdown ---

const SHUTDOWN_TIMEOUT_MS = 5000;

function shutdown(signal: string): void {
  console.log(`[server] Received ${signal}, shutting down...`);

  // Send shutdown event to all active SSE connections
  const connections = Array.from(activeSSEConnections);
  console.log(`[server] Notifying ${connections.length} SSE clients about shutdown`);
  
  let completed = 0;
  const totalConnections = connections.length;

  if (totalConnections === 0) {
    proceedWithShutdown();
    return;
  }

  for (const res of connections) {
    try {
      // Check if response is still writable before attempting to write
      if (!res.destroyed && !res.finished) {
        res.write("event: shutdown\ndata: {}\n\n");
        res.end(() => {
          completed++;
          activeSSEConnections.delete(res);
          if (completed === totalConnections) {
            proceedWithShutdown();
          }
        });
      } else {
        // Connection already closed/destroyed
        activeSSEConnections.delete(res);
        completed++;
        if (completed === totalConnections) {
          proceedWithShutdown();
        }
      }
    } catch (error) {
      console.error("[server] Error sending shutdown event to SSE client:", error);
      activeSSEConnections.delete(res);
      completed++;
      if (completed === totalConnections) {
        proceedWithShutdown();
      }
    }
  }

  // Fallback timeout in case some connections don't respond
  setTimeout(() => {
    if (activeSSEConnections.size > 0) {
      console.log(`[server] ${activeSSEConnections.size} connections didn't respond to shutdown, proceeding anyway`);
      activeSSEConnections.clear();
    }
    proceedWithShutdown();
  }, 2000);

  function proceedWithShutdown(): void {
    console.log("[server] All SSE connections notified, proceeding with shutdown");
    
    // Hard-exit if graceful shutdown takes too long
    const forceExit = setTimeout(() => {
      console.error("[server] Graceful shutdown timed out, forcing exit.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS) as unknown as NodeJS.Timeout;
    // Don't let this timer keep the process alive on its own
    forceExit.unref();
    
    engine.stop();

    server.close(() => {
      console.log("[server] HTTP server closed. Exiting.");
      process.exit(0);
    });
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
