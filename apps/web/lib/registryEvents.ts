import { SorobanRpcClient } from "@orbital-stellar/pulse-core";
import {
  decodeContractEvent,
  resolvableTopicFromXdr,
  SEP41_TAXONOMY,
  TaxonomyResolver,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import type { ContractSpec, TaxonomyResolution, XdrContractSpec } from "@orbital-stellar/abi-registry";

/**
 * "Last N decoded events from the live stream" for the registry explorer's
 * per-contract detail page (#913). This is a bounded, one-shot
 * `getEvents` query at render time - not a subscription - which is what
 * lets the page stay server-rendered with a short cache TTL instead of
 * holding a live connection open per visitor.
 *
 * Soroban RPC's `getEvents` only walks forward from a `startLedger`; there
 * is no "give me the most recent N" call. `LOOKBACK_LEDGERS` bounds how far
 * back this looks for them, so a contract with no recent activity correctly
 * reports zero events found in the window rather than paying for (or ever
 * finishing) a scan of the RPC's full retention history.
 */
const LOOKBACK_LEDGERS = 17_280; // ~1 day at Stellar's ~5s ledger close time
const RPC_PAGE_LIMIT = 200; // Soroban RPC's own per-call cap on most providers

const g = globalThis as unknown as {
  __orbitalExplorerRpc?: SorobanRpcClient;
  __orbitalExplorerTaxonomy?: TaxonomyResolver;
};

function getRpcClient(): SorobanRpcClient {
  if (!g.__orbitalExplorerRpc) {
    g.__orbitalExplorerRpc = new SorobanRpcClient({
      url: process.env.ORBITAL_RPC_URL ?? ORBITAL_REGISTRY_TESTNET_RPC_URL,
    });
  }
  return g.__orbitalExplorerRpc;
}

/** Same default taxonomy EventEngine resolves against (issue #909) - see its own caveat about interface-scoped entries there. */
function getTaxonomyResolver(): TaxonomyResolver {
  if (!g.__orbitalExplorerTaxonomy) {
    g.__orbitalExplorerTaxonomy = new TaxonomyResolver(SEP41_TAXONOMY);
  }
  return g.__orbitalExplorerTaxonomy;
}

export type RecentContractEvent = {
  id: string;
  ledger: number;
  ledgerClosedAt?: string;
  txHash?: string;
  topics: string[];
  /** ABI-decoded, only when `spec` was supplied and decode succeeded. */
  decoded?: unknown;
  decodeError?: string;
  /** Populated only when a taxonomy entry resolves deterministically - never guessed. */
  semantic?: TaxonomyResolution;
};

export type RecentEventsResult =
  | {
      available: true;
      events: ReadonlyArray<RecentContractEvent>;
      /** True when the window held more matching events than `limit` kept. */
      truncated: boolean;
      windowStartLedger: number;
      latestLedger: number;
      fetchedAt: number;
    }
  | { available: false; error: string };

/**
 * Fetches up to `limit` of the most recent `contract.emitted`-shaped events
 * for `contractId` within the last `LOOKBACK_LEDGERS` ledgers, decoding each
 * against `spec` (when supplied) and resolving `semantic` the same way
 * `EventEngine` does.
 */
export async function getRecentContractEvents(
  contractId: string,
  spec: ContractSpec | null,
  limit = 10,
): Promise<RecentEventsResult> {
  const client = getRpcClient();
  try {
    const latestLedger = await client.getLatestLedger();
    const windowStartLedger = Math.max(1, latestLedger - LOOKBACK_LEDGERS);

    const result = await client.getEvents({
      startLedger: windowStartLedger,
      filters: [{ type: "contract", contractIds: [contractId] }],
      limit: RPC_PAGE_LIMIT,
      xdrFormat: "base64",
    });

    const resolver = getTaxonomyResolver();
    const events: RecentContractEvent[] = result.events.map((e) => {
      const topics = (Array.isArray(e.topic) ? e.topic : (e.topics ?? [])) as string[];
      const base: RecentContractEvent = {
        id: e.id,
        ledger: e.ledger,
        ledgerClosedAt: e.ledgerClosedAt,
        txHash: e.txHash,
        topics,
      };

      if (spec) {
        const decoded = decodeContractEvent(spec as XdrContractSpec | ContractSpec, {
          topics,
          data: e.value,
        });
        if ("error" in decoded) base.decodeError = decoded.error;
        else base.decoded = decoded;
      }

      const semantic = resolver.resolve({
        contractId,
        topics: topics.map((t) => resolvableTopicFromXdr(t)),
      });
      if (semantic) base.semantic = semantic;

      return base;
    });

    // Most recent first, capped to `limit`.
    const ordered = [...events].reverse();
    return {
      available: true,
      events: ordered.slice(0, limit),
      truncated: ordered.length > limit,
      windowStartLedger,
      latestLedger,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
