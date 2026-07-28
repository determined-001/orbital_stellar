import { createHash } from "node:crypto";
import { Networks } from "@stellar/stellar-sdk";
import {
  OnChainAbiRegistryClient,
  TaxonomyResolver,
  canonicalizeSpec,
  classifyKnownInterface,
  wellKnownTaxonomyMappings,
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import type { ContractSpec, RegisteredContractSummary, SpecRecord } from "@orbital-stellar/abi-registry";
import { isContractAddress } from "@orbital-stellar/pulse-core";

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
