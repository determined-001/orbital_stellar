import express, { type Request, type Response } from "express";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookRegistry } from "./registry.js";
import { createRoutes } from "./routes.js";
import { config } from "./config.js";

// --- Bootstrap ---

const engine = new EventEngine({ network: config.NETWORK });
engine.start();
console.log(`[server] Event engine started on ${config.NETWORK}`);

const registry = new WebhookRegistry(engine);

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(createRoutes(registry, engine));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", network: config.NETWORK });
});

const server = app.listen(config.PORT, () => {
  console.log(`[server] Listening on port ${config.PORT}`);
});

// --- Graceful shutdown ---

const SHUTDOWN_TIMEOUT_MS = 5000;

function shutdown(signal: string): void {
  console.log(`[server] Received ${signal}, shutting down...`);

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

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
