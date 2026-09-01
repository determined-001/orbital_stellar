import { NextRequest, NextResponse } from "next/server";
import { Networks } from "@stellar/stellar-sdk";
import {
  createDefaultAbiRegistryClient,
  OnChainAbiRegistryClient,
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import { checkRegistryDataCooldown, clientIp } from "@/lib/demo-limits";
import { REGISTRY_DATA_CACHE_CONTROL } from "@/lib/registryData";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

/**
 * Mirrors `createDefaultAbiRegistryClient`'s own env-first convention: an
 * env var override, falling back to the compiled-in constant. This route
 * constructs `OnChainAbiRegistryClient` directly rather than going through
 * `createDefaultAbiRegistryClient`, so it needs the same override path
 * itself rather than being stuck on whatever was compiled in.
 */
function readRegistryConfig(name: string, fallback: string): string {
  const value = process.env[name];
  return value?.trim() ? value.trim() : fallback;
}

// Hoisted to module scope rather than constructed per request: both clients
// carry their own internal caches (bundled well-known lookups, on-chain
// records/spec caches), and a fresh instance per request would defeat that
// cache the moment `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` is populated,
// turning every lookup into a fresh RPC round trip - exactly what the
// "must not fan out to RPC per request" acceptance criterion rules out.
const defaultChainClient = createDefaultAbiRegistryClient();

// Keyed by the resolved (registryContractId, rpcUrl, publisher) triple so a
// caller-supplied `?publisher=` still reuses a client across requests
// instead of only ever caching the configured default.
const onChainClientsByKey = new Map<string, OnChainAbiRegistryClient>();

function getOnChainClient(
  registryContractId: string,
  rpcUrl: string,
  publisher: string,
): OnChainAbiRegistryClient {
  const key = `${registryContractId}:${rpcUrl}:${publisher}`;
  const cached = onChainClientsByKey.get(key);
  if (cached) return cached;

  const client = new OnChainAbiRegistryClient({
    contractId: registryContractId,
    rpcUrl,
    networkPassphrase: Networks.TESTNET,
    publisher,
  });
  onChainClientsByKey.set(key, client);
  return client;
}

/**
 * GET /api/registry-data/spec/[contractId] - the resolved spec for a
 * contract.
 *
 * No query params: resolves via `createDefaultAbiRegistryClient()`'s full
 * chain (bundled well-known specs, then the on-chain registry once it's
 * deployed) and reports provenance via `specSource`.
 *
 * `?version=` / `?publisher=`: bypass the default chain and query the
 * on-chain registry directly for that exact record. Both require the
 * registry contract to actually be deployed - `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID`
 * is empty until then, so these two params return 503 rather than a
 * confusing failure deeper in the RPC call.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const ip = clientIp(request);
  const cooldown = checkRegistryDataCooldown(ip, "spec");
  if (!cooldown.ok) {
    return NextResponse.json(cooldown.body, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  const { contractId } = await params;
  if (!CONTRACT_ID_RE.test(contractId)) {
    return NextResponse.json(
      { error: "invalid_contract_id", message: "contractId must be a C-prefixed 56-character Stellar strkey" },
      { status: 400 },
    );
  }

  const version = request.nextUrl.searchParams.get("version");
  const publisher = request.nextUrl.searchParams.get("publisher");

  try {
    if (version !== null || publisher !== null) {
      const registryContractId = readRegistryConfig(
        "ORBITAL_REGISTRY_TESTNET_CONTRACT_ID",
        ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
      );
      if (!registryContractId) {
        return NextResponse.json(
          {
            error: "registry_not_deployed",
            message:
              "?version= and ?publisher= query the on-chain registry directly, which is not deployed yet. Omit both to resolve via the default chain (bundled well-known specs).",
          },
          { status: 503 },
        );
      }

      const resolvedPublisher =
        publisher ?? readRegistryConfig("ORBITAL_REGISTRY_PUBLISHER_ADDRESS", ORBITAL_REGISTRY_PUBLISHER_ADDRESS);
      if (!resolvedPublisher) {
        return NextResponse.json(
          {
            error: "publisher_required",
            message: "No default publisher is configured; pass ?publisher= explicitly.",
          },
          { status: 400 },
        );
      }

      const client = getOnChainClient(
        registryContractId,
        readRegistryConfig("ORBITAL_REGISTRY_TESTNET_RPC_URL", ORBITAL_REGISTRY_TESTNET_RPC_URL),
        resolvedPublisher,
      );

      const spec = version
        ? await client.getSpecByVersion(contractId, version)
        : await client.getSpec(contractId);

      if (!spec) {
        return NextResponse.json(
          { error: "not_found", message: "No matching spec record for this contract" },
          { status: 404 },
        );
      }

      return NextResponse.json(
        { spec, specSource: "registry", publisher: resolvedPublisher, ...(version ? { version } : {}) },
        { headers: { "Cache-Control": REGISTRY_DATA_CACHE_CONTROL } },
      );
    }

    const resolved = await defaultChainClient.getResolvedSpec(contractId);
    if (!resolved) {
      return NextResponse.json(
        { error: "not_found", message: "No resolved spec for this contract" },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved, {
      headers: { "Cache-Control": REGISTRY_DATA_CACHE_CONTROL },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "resolution_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
