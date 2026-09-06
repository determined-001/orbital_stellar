import {
  InMemoryVerdictStore,
  InMemorySpecStore,
  GitHubIssueReporter,
  ConsoleAlertManager,
  NoopIssueReporter,
  NoopAlertManager,
  runVerificationJob,
} from "@orbital-stellar/abi-registry";
import {
  OnChainAbiRegistryClient,
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "@orbital-stellar/abi-registry";
import type { RegisteredSpec, ContractSpec } from "@orbital-stellar/abi-registry";
import { Networks } from "@stellar/stellar-sdk";
import wellKnownIndex from "@orbital-stellar/abi-registry/specs/well-known/index.json";

const g = globalThis as unknown as {
  __orbitalVerdictStore?: InMemoryVerdictStore;
  __orbitalSpecStore?: InMemorySpecStore;
  __orbitalIssueReporter?: GitHubIssueReporter | NoopIssueReporter;
  __orbitalAlertManager?: ConsoleAlertManager | NoopAlertManager;
};

export function getVerdictStore(): InMemoryVerdictStore {
  if (!g.__orbitalVerdictStore) {
    g.__orbitalVerdictStore = new InMemoryVerdictStore();
  }
  return g.__orbitalVerdictStore;
}

export function getSpecStore(): InMemorySpecStore {
  if (!g.__orbitalSpecStore) {
    g.__orbitalSpecStore = new InMemorySpecStore();
  }
  return g.__orbitalSpecStore;
}

export function getIssueReporter(): GitHubIssueReporter | NoopIssueReporter {
  if (!g.__orbitalIssueReporter) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (token && repo) {
      g.__orbitalIssueReporter = new GitHubIssueReporter(token, repo);
    } else {
      g.__orbitalIssueReporter = new NoopIssueReporter();
    }
  }
  return g.__orbitalIssueReporter;
}

export function getAlertManager(): ConsoleAlertManager | NoopAlertManager {
  if (!g.__orbitalAlertManager) {
    g.__orbitalAlertManager =
      process.env.NODE_ENV === "production"
        ? new ConsoleAlertManager()
        : new NoopAlertManager();
  }
  return g.__orbitalAlertManager;
}

/**
 * A spec as the registry explorer displays it: the on-chain record, plus the
 * spec body resolved through the record's pointer.
 */
export type OnChainSpecView = {
  contractId: string;
  spec: ContractSpec;
};

/**
 * Reads the registry's contents from chain.
 *
 * NOTE ON THE CONTRACT ID SET. The registry contract has no "list every
 * registered contract" entry point - `latest`, `get_version` and
 * `list_versions` are all keyed by `(contract_id, publisher)`. So the set of
 * ids to look up has to come from somewhere off chain; here it is the bundled
 * well-known index, which is exactly what `scripts/seed-well-known.ts`
 * publishes. Every *value* rendered is fetched live and verified against the
 * on-chain spec hash - only the list of ids to ask about is local.
 *
 * A real explorer needs enumeration on the contract itself. That is a
 * registry-contract change, not a page change, and is why this function is
 * written to be replaced rather than extended.
 */
export async function getOnChainSpecs(): Promise<OnChainSpecView[]> {
  if (!ORBITAL_REGISTRY_TESTNET_CONTRACT_ID || !ORBITAL_REGISTRY_PUBLISHER_ADDRESS) {
    return [];
  }

  const client = new OnChainAbiRegistryClient({
    contractId: ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
    rpcUrl: process.env.ORBITAL_RPC_URL ?? ORBITAL_REGISTRY_TESTNET_RPC_URL,
    networkPassphrase: process.env.ORBITAL_NETWORK_PASSPHRASE ?? Networks.TESTNET,
    publisher: ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  });

  const ids = (wellKnownIndex as { specs: { contract_id: string }[] }).specs.map(
    (e) => e.contract_id,
  );

  const results = await Promise.all(
    ids.map(async (contractId): Promise<OnChainSpecView | null> => {
      try {
        const spec = await client.getSpec(contractId);
        return spec ? { contractId, spec } : null;
      } catch {
        // One unreachable or archived entry must not blank the whole page.
        // The caller renders what resolved; an empty result is surfaced as an
        // explicit error state rather than as "nothing is registered".
        return null;
      }
    }),
  );

  return results.filter((r): r is OnChainSpecView => r !== null);
}

export async function runVerification(): Promise<
  Awaited<ReturnType<typeof runVerificationJob>>
> {
  const storedSpecs = await getSpecStore().getAll();
  if (storedSpecs.length === 0) {
    return {
      total: 0,
      verified: 0,
      mismatch: 0,
      unverifiable: 0,
      errors: [],
      issuesCreated: [],
    };
  }

  return runVerificationJob({
    specStore: getSpecStore(),
    verdictStore: getVerdictStore(),
    verifyOptions: {
      rpcUrl: process.env.ORBITAL_RPC_URL ?? "https://soroban-testnet.stellar.org",
      network: (process.env.ORBITAL_NETWORK as "mainnet" | "testnet" | undefined) ?? "testnet",
    },
    issueReporter: getIssueReporter(),
    alertManager: getAlertManager(),
  });
}
