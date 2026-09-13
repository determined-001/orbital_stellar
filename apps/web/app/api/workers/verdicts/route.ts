import { getVerdictSink, VERDICT_SCHEMA_VERSION } from "@/lib/verification";
import { registryRead } from "@/lib/registryReadPolicy";

export const dynamic = "force-dynamic";

/**
 * `GET /api/workers/verdicts?worker=<subject>&start_ledger=&end_ledger=` (19.4).
 *
 * Public, read-only audit trail for chain-derived verification verdicts
 * (19.1/19.2): a subscriber checks whether a worker fired without asking the
 * operator or running an indexer. Reuses `registryRead` (19.4's own
 * acceptance criteria: reuse #915/#918's rate limiting, auth and caching
 * rather than adding a second limiter) for per-IP/per-key limits, ETags and
 * a short cache window.
 *
 * `worker` is required - an unscoped dump of every subject's verdicts is not
 * useful to a subscriber and is the one query shape `registryRead`'s cache
 * cannot bound cheaply. `start_ledger`/`end_ledger` narrow to verdicts whose
 * window overlaps the requested range; omit both for all windows on record.
 */
export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const worker = searchParams.get("worker");
  if (!worker) {
    return Response.json(
      { error: "invalid_request", message: "worker is required" },
      { status: 400 },
    );
  }

  const startLedger = searchParams.get("start_ledger");
  const endLedger = searchParams.get("end_ledger");
  const start = startLedger !== null ? Number(startLedger) : null;
  const end = endLedger !== null ? Number(endLedger) : null;
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) {
    return Response.json(
      { error: "invalid_request", message: "start_ledger and end_ledger must be integers" },
      { status: 400 },
    );
  }

  return registryRead(req, `workers:verdicts:${worker}:${start ?? ""}:${end ?? ""}`, async () => {
    const all = await getVerdictSink().all();
    const forSubject = all.filter((v) => v.subject === worker.toUpperCase());
    const inRange = forSubject.filter((v) => {
      if (start !== null && v.window.endLedger < start) return false;
      if (end !== null && v.window.startLedger > end) return false;
      return true;
    });
    return { meta: { schemaVersion: VERDICT_SCHEMA_VERSION }, data: inRange };
  });
}
