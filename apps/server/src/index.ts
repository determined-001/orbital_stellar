import express, { type Request, type Response } from "express";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookRegistry } from "./registry.js";
import { createRoutes } from "./routes.js";
import { DlqStore, createDlqRoutes } from "@orbital/pulse-webhooks";

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

const engine = new EventEngine({ network: NETWORK });
engine.start();
console.log(`[server] Event engine started on ${NETWORK}`);

const registry = new WebhookRegistry(engine);

const app = express();
app.use(express.json());
app.use(createRoutes(registry, engine));

// --- DLQ routes (requires DATABASE_URL) ---

if (process.env.DATABASE_URL) {
  // Lazy-require pg so the server starts without it when DATABASE_URL is absent.
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dlqStore = new DlqStore(pool);

  const redeliver = async (id: string): Promise<boolean> => {
    const payload = await dlqStore.markReplayed(id);
    if (!payload) return false;
    console.log(`[dlq] Replaying entry ${id} for address ${payload.to}`);
    return true;
  };

  app.use(createDlqRoutes(dlqStore, redeliver));
  console.log("[server] DLQ routes enabled");
} else {
  console.warn("[server] DATABASE_URL not set — DLQ routes disabled");
}

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

  const forceExit = setTimeout(() => {
    console.error("[server] Graceful shutdown timed out, forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS) as unknown as NodeJS.Timeout;
  forceExit.unref();
  engine.stop();

  server.close(() => {
    console.log("[server] HTTP server closed. Exiting.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
