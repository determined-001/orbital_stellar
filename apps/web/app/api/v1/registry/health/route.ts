import { NextResponse } from "next/server";
import { getCachedLedgerSequence } from "@/lib/hostedRegistryApi";

/**
 * GET /api/v1/registry/health - hosted registry API health (issue #915).
 * `lastSyncLedger` is the ledger sequence backing this service's read-through
 * cache as of this request. `stale` means the cache is serving a slightly
 * old value while it refreshes in the background - expected, healthy
 * operation, not degradation. Only an outright failure to reach Soroban RPC
 * (the catch below) is `status: "degraded"`, with `lastSyncLedger: null`
 * rather than a fabricated number.
 */
export async function GET() {
  try {
    const { value: lastSyncLedger, stale } = await getCachedLedgerSequence();
    return NextResponse.json({
      status: "ok",
      lastSyncLedger,
      stale,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        lastSyncLedger: null,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
