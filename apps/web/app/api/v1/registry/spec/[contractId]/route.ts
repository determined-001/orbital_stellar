import { NextRequest, NextResponse } from "next/server";
import {
  getCachedLedgerSequence,
  getCachedResolvedSpec,
  specHashOf,
} from "@/lib/hostedRegistryApi";
import type { HostedApiEnvelope } from "@/lib/hostedRegistryApi";
import type { ContractSpec } from "@orbital-stellar/abi-registry";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

type SpecResponseData = {
  spec: ContractSpec;
  specHash: string;
};

/**
 * GET /api/v1/registry/spec/:contractId - hosted read API for a resolved
 * contract spec (issue #915). Resolves through the same default chain as
 * the rest of the SDK (SEP-48 embedded, bundled well-known, on-chain
 * registry), read through a stale-while-revalidate cache so repeat lookups
 * for the same contract don't each cost an RPC round trip.
 *
 * `?version=` is accepted per the issue's literal signature but is not yet
 * implemented against the default chain (which resolves the latest spec
 * only) - returns 501 rather than silently ignoring the parameter.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;
  if (!CONTRACT_ID_RE.test(contractId)) {
    return NextResponse.json(
      {
        error: "invalid_contract_id",
        message: "contractId must be a C-prefixed 56-character Stellar strkey",
      },
      { status: 400 },
    );
  }

  const version = request.nextUrl.searchParams.get("version");
  if (version !== null) {
    return NextResponse.json(
      {
        error: "not_implemented",
        message:
          "?version= is not yet supported by the hosted spec endpoint - it resolves the latest published spec only.",
      },
      { status: 501 },
    );
  }

  try {
    const [{ value: resolved, stale }, { value: asOfLedger }] = await Promise.all([
      getCachedResolvedSpec(contractId),
      getCachedLedgerSequence(),
    ]);

    if (!resolved) {
      return NextResponse.json(
        { error: "not_found", message: "No resolved spec for this contract" },
        { status: 404 },
      );
    }

    const body: HostedApiEnvelope<SpecResponseData> = {
      data: { spec: resolved.spec, specHash: specHashOf(resolved.spec) },
      servedFrom: resolved.specSource,
      asOfLedger,
      stale,
    };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { error: "resolution_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
