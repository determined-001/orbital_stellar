import { Router, type Request, type Response } from "express";

type AnyDeadLetterStore = {
  list(filter?: Record<string, unknown>): Promise<unknown[]> | unknown[];
};

/**
 * Mounts DLQ inspection routes onto the provided router.
 *
 * GET  /dlq              — list entries (optional ?since=ISO8601, ?url=...)
 * GET  /dlq/dump         — full dump (all entries, no filter)
 * POST /dlq/:id/replay   — mark a single entry as replayed
 */
export function createDlqRoutes(
  store: AnyDeadLetterStore,
  redeliver: (id: string) => Promise<boolean>,
): Router {
  const router = Router();

  router.get("/dlq", async (req: Request, res: Response) => {
    const url = typeof req.query.url === "string" ? req.query.url : undefined;
    const sinceRaw = typeof req.query.since === "string" ? req.query.since : undefined;
    const entries = await store.list({
      ...(url !== undefined && { url }),
      // Support both PostgresDeadLetterStore (failedAtFrom: ISO string)
      // and MemoryDeadLetterStore (since: numeric timestamp).
      ...(sinceRaw !== undefined && { failedAtFrom: sinceRaw, since: Date.parse(sinceRaw) }),
    });
    res.json(entries);
  });

  router.get("/dlq/dump", async (_req: Request, res: Response) => {
    const entries = await store.list({});
    res.json(entries);
  });

  router.post("/dlq/:id/replay", async (req: Request, res: Response) => {
    const id = req.params["id"] ?? "";
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const ok = await redeliver(id);
    if (!ok) {
      res.status(404).json({ error: "Entry not found or already replayed" });
      return;
    }
    res.json({ replayed: id });
  });

  return router;
}
