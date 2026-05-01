import express, { type Request, type Response } from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookRegistry } from "./registry.js";
import { createRoutes } from "./routes.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

// --- Bootstrap ---

const activeSSEConnections = new Set<Response>();

const engine = new EventEngine({ network: config.NETWORK, logger });
engine.start();
logger.info({ network: config.NETWORK }, "Event engine started");

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
app.use("/v1", createRoutes(registry, engine, activeSSEConnections));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", network: config.NETWORK });
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "Listening");
});

// --- Graceful shutdown ---

const SHUTDOWN_TIMEOUT_MS = 5000;

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");

  const connections = Array.from(activeSSEConnections);
  logger.info({ count: connections.length }, "Notifying SSE clients about shutdown");

  let called = false;
  function proceedWithShutdown(): void {
    if (called) return;
    called = true;

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

  if (connections.length === 0) {
    proceedWithShutdown();
    return;
  }

  let completed = 0;
  for (const res of connections) {
    try {
      if (!res.destroyed && !res.writableEnded) {
        res.write("event: shutdown\ndata: {}\n\n");
        res.end(() => {
          activeSSEConnections.delete(res);
          if (++completed === connections.length) proceedWithShutdown();
        });
      } else {
        activeSSEConnections.delete(res);
        if (++completed === connections.length) proceedWithShutdown();
      }
    } catch (err) {
      logger.error({ err }, "Error sending shutdown event to SSE client");
      activeSSEConnections.delete(res);
      if (++completed === connections.length) proceedWithShutdown();
    }
  }

  // Fallback: proceed if any connections don't respond within 2s
  setTimeout(() => {
    activeSSEConnections.clear();
    proceedWithShutdown();
  }, 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
