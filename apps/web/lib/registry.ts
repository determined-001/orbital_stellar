import { createHash } from "node:crypto";
import { Networks, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import {
  OnChainAbiRegistryClient,
  TaxonomyResolver,
  canonicalizeSpec,
  classifyKnownInterface,
  wellKnownTaxonomy,
  wellKnownTaxonomyMappings,
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import type {
  ContractSpec,
  RegisteredContractSummary,
  SpecRecord,
  TaxonomyRecord,
} from "@orbital-stellar/abi-registry";
import { isContractAddress } from "@orbital-stellar/pulse-core";
import { readThrough, peekReadThroughCache } from "@/lib/readThroughCache";

/**
 * Server-only helpers for the `/registry` explorer pages. These read the
 * *deployed* Orbital on-chain ABI registry contract directly - no mock or
 * hardcoded data. Until that contract is actually deployed and seeded
 * (`ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` is populated - see issue 8.3), every
 * function here returns an explicit `{ ok: false, reason: "not_configured" }`
 * rather than fabricating a placeholder listing.
 */

export type RegistryError = {
  ok: false;
  reason: "not_configured" | "invalid_contract_id" | "rpc_error";
  message: string;
};

export type ListContractsResult =
  | { ok: true; contracts: RegisteredContractSummary[]; fetchedAt: string }
  | RegistryError;

export type ContractDetail = {
  contractId: string;
  publisher: string;
  spec: ContractSpec;
  /** Every published version, oldest first. */
  versions: SpecRecord[];
  /** `spec.events[].name -> semantic` for whichever event names the bundled taxonomy maps, via interfaceId classification. Omitted entries are genuinely unmapped, not an error. */
  semantics: Record<string, string>;
};

export type ContractDetailResult = { ok: true; detail: ContractDetail } | RegistryError;

export function isRegistryConfigured(): boolean {
  return ORBITAL_REGISTRY_TESTNET_CONTRACT_ID !== "" && ORBITAL_REGISTRY_PUBLISHER_ADDRESS !== "";
}

const NOT_CONFIGURED: RegistryError = {
  ok: false,
  reason: "not_configured",
  message:
    "Orbital's on-chain ABI registry contract hasn't been deployed and seeded yet " +
    "(ORBITAL_REGISTRY_TESTNET_CONTRACT_ID is unset - see issue 8.3). No live registry data is available.",
};

let cachedClient: OnChainAbiRegistryClient | undefined;
function getClient(): OnChainAbiRegistryClient {
  if (!cachedClient) {
    cachedClient = new OnChainAbiRegistryClient({
      contractId: ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
      rpcUrl: ORBITAL_REGISTRY_TESTNET_RPC_URL,
      networkPassphrase: Networks.TESTNET,
      publisher: ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
    });
  }
  return cachedClient;
}

let cachedTaxonomy: TaxonomyResolver | undefined;
function getTaxonomyResolver(): TaxonomyResolver {
  if (!cachedTaxonomy) {
    cachedTaxonomy = TaxonomyResolver.loadTrusted(wellKnownTaxonomyMappings);
  }
  return cachedTaxonomy;
}

/** Lists contracts observed in the registry's recent `SpecPublished` event history - see `OnChainAbiRegistryClient.listRegisteredContracts`'s own doc comment for the bounded-lookback caveat this inherits. */
export async function listRegisteredContracts(): Promise<ListContractsResult> {
  if (!isRegistryConfigured()) return NOT_CONFIGURED;

  try {
    const contracts = await getClient().listRegisteredContracts();
    return { ok: true, contracts, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      reason: "rpc_error",
      message: err instanceof Error ? err.message : "Failed to reach the Soroban RPC endpoint.",
    };
  }
}

/** Resolves one contract's spec, full version history, and (best-effort) semantic labels for its declared events. */
export async function getContractDetail(contractId: string): Promise<ContractDetailResult> {
  if (!isRegistryConfigured()) return NOT_CONFIGURED;
  if (!isContractAddress(contractId)) {
    return {
      ok: false,
      reason: "invalid_contract_id",
      message: `"${contractId}" is not a valid Soroban contract address.`,
    };
  }

  try {
    const client = getClient();
    const [spec, versions] = await Promise.all([client.getSpec(contractId), client.listVersions(contractId)]);

    if (!spec) {
      return {
        ok: false,
        reason: "rpc_error",
        message: `No spec has been published for ${contractId} under the configured publisher.`,
      };
    }

    const specHash = createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");
    const interfaceId = classifyKnownInterface(spec);
    const taxonomy = getTaxonomyResolver();

    const semantics: Record<string, string> = {};
    for (const event of spec.events) {
      const resolved = taxonomy.resolve({ contractId, eventTopic: event.name, specHash, interfaceId });
      if (resolved !== undefined) semantics[event.name] = resolved;
    }

    return { ok: true, detail: { contractId, publisher: ORBITAL_REGISTRY_PUBLISHER_ADDRESS, spec, versions, semantics } };
  } catch (err) {
    return {
      ok: false,
      reason: "rpc_error",
      message: err instanceof Error ? err.message : "Failed to reach the Soroban RPC endpoint.",
    };
  }
}

// ---------------------------------------------------------------------------
// Hosted read API (issue #915 / "12.1") - GET /v1/registry/*
//
// Every function below backs one of the /v1/registry/* routes. All reads go
// through `readThrough` (explicit TTL + stale-while-revalidate - see
// lib/readThroughCache.ts); every result surfaces `servedFrom`/`stale` so
// staleness is never silent, per this issue's own acceptance criteria.
// ---------------------------------------------------------------------------

const LEDGER_CACHE_KEY = "asOfLedger";
const LEDGER_TTL_MS = 5_000;
const LEDGER_STALE_MS = 30_000;

const SPEC_TTL_MS = 60_000;
const SPEC_STALE_MS = 5 * 60_000;

const TAXONOMY_TTL_MS = 5 * 60_000;
const TAXONOMY_STALE_MS = 30 * 60_000;

export type ApiMeta = {
  servedFrom: "cache" | "live";
  stale: boolean;
  /** `null` when the current chain height couldn't be determined (RPC unreachable and nothing cached yet) - never fabricated. */
  asOfLedger: number | null;
};

async function fetchLatestLedger(): Promise<number> {
  const server = new SorobanRpc.Server(ORBITAL_REGISTRY_TESTNET_RPC_URL);
  const { sequence } = await server.getLatestLedger();
  return sequence;
}

/** The current chain height, read-through cached - used as every API response's `asOfLedger`. Never throws: returns `{ ledger: null, ... }` if the RPC is unreachable and nothing has ever been cached. */
async function getAsOfLedger(): Promise<{ ledger: number | null; servedFrom: "cache" | "live"; stale: boolean }> {
  try {
    const result = await readThrough(
      LEDGER_CACHE_KEY,
      { ttlMs: LEDGER_TTL_MS, staleWhileRevalidateMs: LEDGER_STALE_MS },
      fetchLatestLedger,
    );
    return { ledger: result.value, servedFrom: result.servedFrom, stale: result.stale };
  } catch {
    return { ledger: null, servedFrom: "live", stale: true };
  }
}

export type ApiSpecResult =
  | { ok: true; spec: ContractSpec; specHash: string; version: string; meta: ApiMeta }
  | RegistryError;

/** Resolves a contract's spec for the hosted API - latest version, or an exact `version` if given. */
export async function getSpecForApi(contractId: string, version?: string): Promise<ApiSpecResult> {
  if (!isRegistryConfigured()) return NOT_CONFIGURED;
  if (!isContractAddress(contractId)) {
    return {
      ok: false,
      reason: "invalid_contract_id",
      message: `"${contractId}" is not a valid Soroban contract address.`,
    };
  }

  try {
    const cacheKey = `spec:${contractId}:${version ?? "latest"}`;
    const cached = await readThrough(
      cacheKey,
      { ttlMs: SPEC_TTL_MS, staleWhileRevalidateMs: SPEC_STALE_MS },
      async () => {
        const client = getClient();
        const spec = version ? await client.getSpecByVersion(contractId, version) : await client.getSpec(contractId);
        if (!spec) return null;
        const specHash = createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");
        return { spec, specHash };
      },
    );

    if (!cached.value) {
      return {
        ok: false,
        reason: "rpc_error",
        message: `No spec has been published for ${contractId}${version ? ` at version ${version}` : ""} under the configured publisher.`,
      };
    }

    const asOf = await getAsOfLedger();
    return {
      ok: true,
      spec: cached.value.spec,
      specHash: cached.value.specHash,
      version: cached.value.spec.version,
      meta: { servedFrom: cached.servedFrom, stale: cached.stale, asOfLedger: asOf.ledger },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "rpc_error",
      message: err instanceof Error ? err.message : "Failed to reach the Soroban RPC endpoint.",
    };
  }
}

export type ApiTaxonomyResult = {
  ok: true;
  taxonomy: TaxonomyRecord;
  taxonomyHash: string;
  meta: ApiMeta;
};

/** The bundled taxonomy record - a static resource, no RPC needed for the record itself, though `asOfLedger` still reflects current chain height for consistency with the other endpoints. */
export async function getTaxonomyForApi(): Promise<ApiTaxonomyResult> {
  const cached = await readThrough(
    "taxonomy",
    { ttlMs: TAXONOMY_TTL_MS, staleWhileRevalidateMs: TAXONOMY_STALE_MS },
    async () => ({
      taxonomy: wellKnownTaxonomy,
      taxonomyHash: createHash("sha256").update(JSON.stringify(wellKnownTaxonomy)).digest("hex"),
    }),
  );
  const asOf = await getAsOfLedger();
  return {
    ok: true,
    taxonomy: cached.value.taxonomy,
    taxonomyHash: cached.value.taxonomyHash,
    meta: { servedFrom: cached.servedFrom, stale: cached.stale, asOfLedger: asOf.ledger },
  };
}

export type ApiLabelsResult = {
  ok: true;
  labels: never[];
  notImplemented: true;
  message: string;
  meta: ApiMeta;
};

/**
 * Entity labels (contract → protocol/deployer/issuer attribution, issue 11.2
 * / #910) are not implemented anywhere in this codebase - no design, no
 * data source, nothing to read from. Rather than fabricate label data (or
 * silently 404, which would violate this issue's own "serve live data"
 * requirement), this always returns a genuinely correct empty result -
 * "no labels are known" is true today - with `notImplemented: true` so
 * callers don't mistake "empty" for "this contract has no labels" once
 * 11.2 ships real data.
 */
export async function getLabelsForApi(): Promise<ApiLabelsResult> {
  const asOf = await getAsOfLedger();
  return {
    ok: true,
    labels: [],
    notImplemented: true,
    message:
      "Entity labels (protocol/deployer/issuer attribution) aren't implemented yet - see issue 11.2 (#910). This always returns an empty list, never fabricated data.",
    meta: { servedFrom: asOf.servedFrom, stale: asOf.stale, asOfLedger: asOf.ledger },
  };
}

export type RegistryHealth = {
  configured: boolean;
  rpcReachable: boolean;
  /** The most recent ledger height this API has actually observed - `null` if it has never successfully reached the RPC. */
  lastSyncLedger: number | null;
  registryContractId: string | null;
  publisher: string | null;
  checkedAt: string;
};

/** Live RPC reachability check (bypasses the ledger cache deliberately - health should reflect the current call, not a stale one) with a best-effort fallback to whatever was last cached for `lastSyncLedger` when the live call fails. */
export async function getRegistryHealth(): Promise<RegistryHealth> {
  const configured = isRegistryConfigured();
  let rpcReachable = false;
  let lastSyncLedger: number | null = null;

  try {
    lastSyncLedger = await fetchLatestLedger();
    rpcReachable = true;
  } catch {
    const cached = peekReadThroughCache<number>(LEDGER_CACHE_KEY);
    lastSyncLedger = cached?.value ?? null;
  }

  return {
    configured,
    rpcReachable,
    lastSyncLedger,
    registryContractId: configured ? ORBITAL_REGISTRY_TESTNET_CONTRACT_ID : null,
    publisher: configured ? ORBITAL_REGISTRY_PUBLISHER_ADDRESS : null,
    checkedAt: new Date().toISOString(),
  };
}
