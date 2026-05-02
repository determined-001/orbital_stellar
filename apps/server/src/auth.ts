import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = config.API_KEY;

  // Accept key via Authorization header (REST) or ?token= query param (EventSource/SSE)
  const authHeader = req.headers["authorization"];
  const headerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const queryKey = typeof req.query.token === "string" ? req.query.token : null;
  const provided = headerKey ?? queryKey;

  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
