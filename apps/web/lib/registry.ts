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
  ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE,
  buildWellKnownOfflineBlobs,
} from "@orbital-stellar/abi-registry";
import type { RegisteredSpec, ContractSpec } from "@orbital-stellar/abi-registry";
import wellKnownIndex from "@orbital-stellar/abi-registry/specs/well-known/index.json";

const g = globalThis as unknown as {
  __orbitalVerdictStore?: InMemoryVerdictStore;
  __orbitalSpecStore?: InMemorySpecStore;
  __orbitalIssueReporter?: GitHubIssueReporter | NoopIssueReporter;
  __orbitalAlertManager?: ConsoleAlertManager | NoopAlertManager;
  __orbitalOnChainRegistry?: OnChainAbiRegistryClient;
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
 * One client for the process, not one per request.
 *
 * `OnChainAbiRegistryClient` carries a TTL cache of records and resolved
 * specs. Constructing it inside the request threw that cache away every time,
 * so each page render did five RPC simulations and five pointer fetches from
 * cold - about four seconds of network per view, and all ten calls failing
 * together whenever the network hiccuped. Rendering the registry as empty
 * because GitHub was briefly slow is not an accurate report of the registry.
 *
 * Hoisting it makes the cache do its job: the first render pays for the reads
 * and the rest are served from memory until the TTL lapses.
 */
function getOnChainRegistryClient(): OnChainAbiRegistryClient {
  if (!g.__orbitalOnChainRegistry) {
    g.__orbitalOnChainRegistry = new OnChainAbiRegistryClient({
      contractId: ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
      rpcUrl: process.env.ORBITAL_RPC_URL ?? ORBITAL_REGISTRY_TESTNET_RPC_URL,
      networkPassphrase:
        process.env.ORBITAL_NETWORK_PASSPHRASE ?? ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE,
      publisher: ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
      // The four well-known specs are in this repository, so their blobs never
      // need fetching: the chain supplies the hash and we already hold bytes
      // that match it. Halves the network calls per cold read and drops
      // raw.githubusercontent.com out of the path entirely.
      offlineBlobs: buildWellKnownOfflineBlobs(),
    });
  }
  return g.__orbitalOnChainRegistry;
}

/**
 * A spec as the registry explorer displays it: the on-chain record, plus the
 * spec body resolved through the record's pointer.
 */
export type OnChainSpecView = {
  contractId: string;
  spec: ContractSpec;
};

/** A contract the registry could not be read for, and why. */
export type OnChainSpecFailure = {
  contractId: string;
  reason: string;
};

/**
 * What the explorer got: what resolved, and what did not.
 *
 * Both halves matter. Returning only the successes makes a transient RPC
 * timeout indistinguishable from a contract that was never registered - the
 * page would quietly show three of four rows and claim nothing was wrong. A
 * registry explorer that cannot tell "I could not read this" from "this does
 * not exist" is misreporting the thing it exists to report.
 */
export type OnChainSpecsResult = {
  specs: OnChainSpecView[];
  failures: OnChainSpecFailure[];
  /** False when no registry contract is configured at all. */
  configured: boolean;
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
export async function getOnChainSpecs(): Promise<OnChainSpecsResult> {
  if (!ORBITAL_REGISTRY_TESTNET_CONTRACT_ID || !ORBITAL_REGISTRY_PUBLISHER_ADDRESS) {
    return { specs: [], failures: [], configured: false };
  }

  const client = getOnChainRegistryClient();

  const ids = (wellKnownIndex as { specs: { contract_id: string }[] }).specs.map(
    (e) => e.contract_id,
  );

  const specs: OnChainSpecView[] = [];
  const failures: OnChainSpecFailure[] = [];

  await Promise.all(
    ids.map(async (contractId) => {
      try {
        const spec = await client.getSpec(contractId);
        // `null` is "no spec published for this contract", which is a fact
        // about the registry rather than a failure to read it - the bundled
        // index deliberately lists the SAC interface placeholder, which is
        // never seeded.
        if (spec) specs.push({ contractId, spec });
      } catch (err) {
        const cause = (err as { cause?: { code?: string; message?: string; errors?: unknown[] } })
          ?.cause;
        // undici reports transport problems as a bare "fetch failed"; the
        // reason a reader actually needs - ETIMEDOUT, ENOTFOUND, a refused
        // connection - is only on the cause. Surfacing it is the difference
        // between an operator diagnosing this in seconds and guessing.
        const detail = cause
          ? ` (${[
              cause.code,
              cause.message,
              Array.isArray(cause.errors)
                ? cause.errors.map((e) => (e as Error)?.message ?? String(e)).join("; ")
                : undefined,
            ]
              .filter(Boolean)
              .join(" ")})`
          : "";
        failures.push({
          contractId,
          reason: `${err instanceof Error ? err.message : String(err)}${detail}`,
        });
      }
    }),
  );

  specs.sort((a, b) => a.spec.name.localeCompare(b.spec.name));
  return { specs, failures, configured: true };
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
