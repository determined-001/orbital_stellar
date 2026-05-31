import { Router, type Request, type Response } from "express";
import type { DlqStore } from "./DlqStore.js";

/**
 * Mounts DLQ inspection routes onto the provided router.
 *
 * GET  /dlq          — list entries (optional ?since=ISO8601)
 * GET  /dlq/dump     — full dump (all entries, no filter)
 * POST /dlq/:id/replay — re-deliver a single entry
 */
export function createDlqRoutes(
  store: DlqStore,
  redeliver: (id: string) => Promise<boolean>
): Router {
  const router = Router();

  router.get("/dlq", async (req: Request, res: Response) => {
    const since =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const entries = await store.list(since);
    res.json(entries);
  });

  router.get("/dlq/dump", async (_req: Request, res: Response) => {
    const entries = await store.dump();
    res.json(entries);
  });

  router.post("/dlq/:id/replay", async (req: Request, res: Response) => {
    const { id } = req.params;
    const ok = await redeliver(id);
    if (!ok) {
      res.status(404).json({ error: "Entry not found or already replayed" });
      return;
    }
    res.json({ replayed: id });
  });

  return router;
}
