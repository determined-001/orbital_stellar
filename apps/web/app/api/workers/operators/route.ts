import { SCORE_FORMULA_VERSION } from "@orbital-stellar/worker-core";
import { scoreOperatorView } from "@/lib/workers";
import { registryRead } from "@/lib/registryReadPolicy";

export const dynamic = "force-dynamic";

/**
 * `GET /api/workers/operators?operator=<id>` (19.4).
 *
 * Public, read-only reputation score for one operator - the scorecard page's
 * own data source, exposed so a subscriber can read it without an indexer.
 * `operator` is required for the same reason as `worker` on the verdicts
 * route: an unscoped dump of every operator's score isn't useful and isn't
 * cheap to cache. Reuses `registryRead` per 19.4's acceptance criteria.
 */
export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const operator = searchParams.get("operator");
  if (!operator) {
    return Response.json(
      { error: "invalid_request", message: "operator is required" },
      { status: 400 },
    );
  }

  return registryRead(req, `workers:operators:${operator}`, async () => {
    const { score, metrics } = scoreOperatorView(operator);
    return { meta: { formulaVersion: SCORE_FORMULA_VERSION }, data: { score, metrics } };
  });
}
