import { Router, type Request, type Response } from "express";
import { StrKey, type EventEngine } from "@orbital/pulse-core";
import type { WebhookRegistry } from "./registry.js";
import { requireApiKey } from "./auth.js";

// --- SSRF-safe URL validation ---

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function validateWebhookUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "url must be a valid URL";
  }

  if (parsed.protocol !== "https:") {
    return "url must use HTTPS";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "::1") {
    return "url must not target localhost";
  }

  if (PRIVATE_IP_RE.test(hostname)) {
    return "url must not target a private IP range";
  }

  return null; // valid
}

// --- Routes ---

export function createRoutes(registry: WebhookRegistry, engine: EventEngine): Router {
  const router = Router();

  // Apply auth to every route in this router
  router.use(requireApiKey);

  // Register a webhook
  router.post("/webhooks/register", (req: Request, res: Response) => {
    const { address, url, secret } = req.body as Record<string, unknown>;

    if (!address || !url || !secret) {
      res.status(400).json({ error: "address, url and secret are required" });
      return;
    }

    if (typeof address !== "string" || typeof url !== "string" || typeof secret !== "string") {
      res.status(400).json({ error: "address, url and secret must be strings" });
      return;
    }

    // Validate Stellar public key
    if (!StrKey.isValidEd25519PublicKey(address)) {
      res.status(400).json({ error: "address must be a valid Stellar public key" });
      return;
    }

    // Validate webhook URL (HTTPS, no SSRF)
    const urlError = validateWebhookUrl(url);
    if (urlError) {
      res.status(400).json({ error: urlError });
      return;
    }

    if (registry.has(address)) {
      res.status(409).json({ error: "Address already registered" });
      return;
    }

    const registration = registry.register(address, url, secret);
    res.status(201).json(registration);
  });

  // Unregister a webhook
  router.delete("/webhooks/:address", (req: Request<{ address: string }>, res: Response) => {
    const { address } = req.params;
    const removed = registry.unregister(address);

    if (!removed) {
      res.status(404).json({ error: "Address not registered" });
      return;
    }

    res.status(200).json({ message: `Unregistered ${address}` });
  });

  // List all registrations — secrets are never included
  router.get("/webhooks", (_req: Request, res: Response) => {
    res.status(200).json(registry.list());
  });

  // Get a single registration
  router.get("/webhooks/:address", (req: Request<{ address: string }>, res: Response) => {
    const { address } = req.params;
    if (!registry.has(address)) {
      res.status(404).json({ error: "Address not registered" });
      return;
    }
    // list() already strips secrets; find the one entry
    const entry = registry.list().find((r) => r.address === address);
    res.status(200).json(entry);
  });

  // SSE endpoint — browser connects here to receive live events
  router.get("/events/:address", (req: Request<{ address: string }>, res: Response) => {
    const { address } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const watcher = engine.subscribe(address);

    const handler = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    watcher.on("*", handler);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    req.on("close", () => {
      clearInterval(heartbeat);
      watcher.removeListener("*", handler);
      engine.unsubscribe(address);
      req.log.info({ address }, "SSE client disconnected");
    });

    req.log.info({ address }, "SSE client connected");
  });

  return router;
}
