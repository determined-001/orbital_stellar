import express, { type Request, type Response } from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookRegistry } from "./registry.js";
import { createRoutes } from "./routes.js";
import { logger } from "./logger.js";

// --- Environment validation ---

const VALID_NETWORKS = ["mainnet", "testnet"] as const;
type Network = (typeof VALID_NETWORKS)[number];

const rawNetwork = process.env.NETWORK;
if (!rawNetwork || !(VALID_NETWORKS as readonly string[]).includes(rawNetwork)) {
  logger.error({ network: rawNetwork }, "Invalid or missing NETWORK env var. Must be mainnet or testnet.");
  process.exit(1);
}
const NETWORK = rawNetwork as Network;

const rawPort = process.env.PORT;
const parsedPort = rawPort ? parseInt(rawPort, 10) : NaN;
let PORT: number;
if (!rawPort || isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  logger.warn({ port: rawPort }, "Invalid or missing PORT env var. Falling back to 3000.");
  PORT = 3000;
} else {
  PORT = parsedPort;
}

// --- Bootstrap ---

const engine = new EventEngine({ network: NETWORK, logger });
engine.start();
logger.info({ network: NETWORK }, "Event engine started");

const registry = new WebhookRegistry(engine, logger);

const app = express();

app.use(
  pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  })
);

// Propagate the request ID as a response header so callers can correlate logs
app.use((req, res, next) => {
  res.setHeader("X-Request-ID", req.id as string);
  next();
});

app.use(express.json({ limit: "16kb" }));
app.use("/v1", createRoutes(registry, engine));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", network: NETWORK });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Listening");
});

// --- Graceful shutdown ---

const SHUTDOWN_TIMEOUT_MS = 5000;

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS) as unknown as NodeJS.Timeout;
  forceExit.unref();

  engine.stop();

  server.close(() => {
    logger.info("HTTP server closed. Exiting.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
