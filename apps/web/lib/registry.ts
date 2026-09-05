import {
  InMemoryVerdictStore,
  InMemorySpecStore,
  GitHubIssueReporter,
  ConsoleAlertManager,
  NoopIssueReporter,
  NoopAlertManager,
  runVerificationJob,
} from "@orbital-stellar/abi-registry";
import type { RegisteredSpec } from "@orbital-stellar/abi-registry";

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

export async function registerSeedSpecs(): Promise<void> {
  const store = getSpecStore();
  const existing = await store.getAll();
  if (existing.length > 0) return;

  const seedSpecs: RegisteredSpec[] = [
    {
      contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      spec: {
        version: "1.0.0",
        name: "USDC",
        contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
        network: "mainnet",
        functions: [],
        events: [],
        types: {},
      },
      submittedAt: new Date().toISOString(),
    },
    {
      contractId: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV",
      spec: {
        version: "1.0.0",
        name: "EURC",
        contractId: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV",
        network: "mainnet",
        functions: [],
        events: [],
        types: {},
      },
      submittedAt: new Date().toISOString(),
    },
    {
      contractId: "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK",
      spec: {
        version: "1.0.0",
        name: "AQUA",
        contractId: "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK",
        network: "mainnet",
        functions: [],
        events: [],
        types: {},
      },
      submittedAt: new Date().toISOString(),
    },
  ];

  for (const spec of seedSpecs) {
    await store.register(spec);
  }
}

export async function runVerification(): Promise<
  Awaited<ReturnType<typeof runVerificationJob>>
> {
  await registerSeedSpecs();

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
