import { getLabelsForApi } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Entity labels (issue 11.2 / #910) aren't implemented - see
 * `getLabelsForApi`'s doc comment. This always returns an honestly empty
 * list rather than fabricated data.
 */
export async function GET() {
  const result = await getLabelsForApi();

  return Response.json({
    labels: result.labels,
    notImplemented: result.notImplemented,
    message: result.message,
    servedFrom: result.meta.servedFrom,
    stale: result.meta.stale,
    asOfLedger: result.meta.asOfLedger,
  });
}
