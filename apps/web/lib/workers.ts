import {
  type ReputationVerdict as Verdict,
  type ScoreConfig,
  SCORE_FORMULA_VERSION,
  scoreOperator,
  selectWindow,
  computeWindowMetrics,
} from "@orbital-stellar/worker-core";

/**
 * Operator verdicts for the worker reputation scorecards.
 *
 * Mirrors the store pattern in `@/lib/registry` (a `globalThis` singleton so
 * the demo server keeps one in-memory copy). The shape extends the worker-core
 * {@link Verdict} with a `txHash` so each verdict can link out to
 * stellar.expert, and an optional `label` for display.
 *
 * This is demo data: it is seeded deterministically on first access. In
 * production the verdicts arrive chain-derived (see `ORBITAL_PRD.md` §C.6) and
 * would be read from the same store backed by a real source.
 */

export type OperatorVerdict = Verdict & {
  /** Stellar transaction hash, for linking out to stellar.expert. */
  txHash: string;
  /** Human-readable operator display name. */
  label?: string;
};

export const WORKER_SCORE_CONFIG: ScoreConfig = {
  formulaVersion: SCORE_FORMULA_VERSION,
  windowMs: 30 * 86_400_000,
  halfLifeMs: 7 * 86_400_000,
  minSamples: 20,
  latencyTargetMs: 2000,
};

/**
 * stellar.expert names mainnet "public" in its path, so the network has to be
 * mapped rather than interpolated. `ORBITAL_NETWORK` is the same switch
 * `lib/registry.ts` reads, and it defaults to testnet the same way — this
 * deployment is testnet, and a verdict linked to the mainnet explorer 404s.
 */
const STELLAR_EXPERT_NETWORK_PATH = { testnet: "testnet", mainnet: "public" } as const;

function stellarExpertNetwork(): string {
  const network = (process.env.ORBITAL_NETWORK as "mainnet" | "testnet" | undefined) ?? "testnet";
  return STELLAR_EXPERT_NETWORK_PATH[network] ?? "testnet";
}

export function stellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/${stellarExpertNetwork()}/tx/${txHash}`;
}

/** Stable 64-char hex from a seed string (FNV-1a + xorshift mixing). */
function pseudoHash(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  let x = h;
  for (let i = 0; i < 16; i++) {
    x = Math.imul(x ^ (x >>> 13), 0x5bd1e995) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64).padEnd(64, "0");
}

class OperatorVerdictStore {
  private byOperator = new Map<string, OperatorVerdict[]>();

  getAll(): OperatorVerdict[] {
    return [...this.byOperator.values()].flat();
  }

  operatorIds(): string[] {
    return [...this.byOperator.keys()];
  }

  getForOperator(id: string): OperatorVerdict[] {
    return this.byOperator.get(id) ?? [];
  }

  getLatest(id: string): OperatorVerdict | null {
    const arr = this.byOperator.get(id);
    return arr && arr.length > 0 ? arr[arr.length - 1]! : null;
  }

  add(v: OperatorVerdict): void {
    const arr = this.byOperator.get(v.operatorId) ?? [];
    arr.push(v);
    this.byOperator.set(v.operatorId, arr);
  }
}

const g = globalThis as unknown as { __orbitalOperatorStore?: OperatorVerdictStore };

export function getOperatorStore(): OperatorVerdictStore {
  if (!g.__orbitalOperatorStore) {
    const store = new OperatorVerdictStore();
    seedOperators(store);
    g.__orbitalOperatorStore = store;
  }
  return g.__orbitalOperatorStore;
}

function seedOperators(store: OperatorVerdictStore): void {
  const now = Date.now();
  const day = 86_400_000;
  const window = 30 * day;

  const operators: {
    id: string;
    label: string;
    count: number;
    missRate: number;
    latencyBase: number;
    seed: number;
  }[] = [
    {
      id: "settlement-desk-alpha",
      label: "Settlement Desk Alpha",
      count: 140,
      missRate: 0.01,
      latencyBase: 900,
      seed: 11,
    },
    {
      id: "meridian-pay",
      label: "Meridian Pay",
      count: 124,
      missRate: 0.04,
      latencyBase: 1200,
      seed: 22,
    },
    {
      id: "tessera-clearing",
      label: "Tessera Clearing",
      count: 96,
      missRate: 0.08,
      latencyBase: 1500,
      seed: 33,
    },
    {
      id: "polaris-node",
      label: "Polaris Node",
      count: 58,
      missRate: 0.18,
      latencyBase: 1800,
      seed: 44,
    },
    // newco has too few verdicts -> demonstrates the "insufficient data" state.
    {
      id: "newco-operator",
      label: "Newco Operator",
      count: 7,
      missRate: 0.1,
      latencyBase: 1100,
      seed: 55,
    },
    // ghost has none -> demonstrates the empty state.
    { id: "ghost-relay", label: "Ghost Relay", count: 0, missRate: 0, latencyBase: 1000, seed: 66 },
  ];

  for (const op of operators) {
    let s = op.seed;
    const rand = (): number => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < op.count; i++) {
      const at = now - Math.floor((i / Math.max(1, op.count)) * window) - Math.floor(rand() * day);
      const isMiss = rand() < op.missRate;
      const latency = isMiss ? 0 : Math.round(op.latencyBase + (rand() - 0.5) * 600);
      store.add({
        id: `${op.id}-v${i}`,
        operatorId: op.id,
        at,
        outcome: isMiss ? "miss" : "success",
        latencyMs: latency,
        txHash: pseudoHash(`${op.id}-${i}`),
        label: op.label,
      });
    }
  }
}

/**
 * Compute the scorecard view for one operator at `asOf`: the scored result,
 * the per-window metrics, and the verdicts inside the window (for display).
 */
export function scoreOperatorView(
  operatorId: string,
  asOf: number = Date.now(),
): {
  verdicts: OperatorVerdict[];
  score: ReturnType<typeof scoreOperator>;
  metrics: ReturnType<typeof computeWindowMetrics>;
} {
  const store = getOperatorStore();
  const verdicts = store.getForOperator(operatorId);
  const score = scoreOperator(verdicts, operatorId, WORKER_SCORE_CONFIG, asOf);
  const sel = selectWindow(verdicts, operatorId, WORKER_SCORE_CONFIG.windowMs, asOf);
  const metrics = computeWindowMetrics(sel);
  // `sel.verdicts` is typed as `Verdict[]`, but the underlying objects are the
  // `OperatorVerdict`s we stored (selectWindow copies references), so this cast
  // is sound for display.
  return { verdicts: sel.verdicts as OperatorVerdict[], score, metrics };
}
