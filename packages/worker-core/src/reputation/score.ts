/**
 * Operator reputation - scoring.
 *
 * The score is a single `0..1000` number per operator, derived purely from
 * chain-derived {@link Verdict} records. It is deliberately a *judgment
 * surface*: the windowing, the recency weighting of a recent miss against an
 * old one, and how a brand-new operator with no history is represented all
 * change operator behavior, so the formula is reviewed and version-stamped
 * (see `docs/design/worker-reputation.md`).
 *
 * Design invariants (enforced here, required by the issue):
 *
 * 1. **Recomputable.** `scoreOperator` is a pure function of its inputs. There
 *    is no incremental accumulator; the same verdicts + config + `asOf` always
 *    yield the same score. A score can be reproduced from stored verdicts alone,
 *    which is what makes it defensible in a dispute.
 * 2. **No default score.** An operator with too few verdicts is reported as
 *    `insufficient_data`, never as a neutral or penalty score.
 * 3. **Version-stamped.** Every score carries `formulaVersion`. A recomputation
 *    under a different formula is distinguishable from a real performance
 *    change because the stamp differs.
 * 4. **Attributable.** Every scored result lists its `contributors` - the
 *    verdicts (misses and latency outliers) that dragged it down - so a drop
 *    can be linked to specific verdicts via {@link attributableDrop}.
 * 5. **Information only.** The score carries no staking, slashing, or bonding.
 *    It is a signal, not an economic enforcement mechanism (see `ORBITAL_PRD.md`
 *    §C.4). Do not add economics here.
 */

import {
  type Verdict,
  type WindowMetrics,
  type WindowSelection,
  computeWindowMetrics,
  selectWindow,
} from "./window.js";

/**
 * The formula version stamped onto every score. Bump this constant when the
 * scoring formula changes; the new code will then stamp the new version, and
 * any score computed under the old version remains distinguishable by its
 * stamp. `scoreOperator` refuses to run with a mismatched `config.formulaVersion`
 * so that a stale stamp can never silently masquerade as current.
 */
export const SCORE_FORMULA_VERSION = "1.0.0";

/** Default relative weights for the two scored dimensions. Need not sum to 1. */
export const DEFAULT_WEIGHTS = { availability: 0.7, latency: 0.3 } as const;

export interface ScoreConfig {
  /**
   * Must equal {@link SCORE_FORMULA_VERSION}. Stamped onto every score so a
   * recomputation under a newer formula is distinguishable from a real change.
   */
  formulaVersion: string;
  /** Sliding window length in ms over which metrics are computed. */
  windowMs: number;
  /**
   * Recency half-life in ms: a verdict's weight halves every `halfLifeMs` of
   * age. This is what makes a recent miss hurt more than an old one.
   */
  halfLifeMs: number;
  /**
   * Minimum verdicts in the window before a score is produced. Below this the
   * operator is `insufficient_data` - never a default score.
   */
  minSamples: number;
  /** p95 latency SLO target in ms. Latency quality degrades above this. */
  latencyTargetMs: number;
  /** Relative weights for availability vs latency. Defaults to {@link DEFAULT_WEIGHTS}. */
  weights?: { availability: number; latency: number };
}

export type ScoreContributorReason = "miss" | "slow";

export interface ScoreContributor {
  /** The verdict that detracted from the score. */
  verdict: Verdict;
  /** Why it detracted. */
  reason: ScoreContributorReason;
  /**
   * Estimated contribution to the score on the `0..1000` scale. Always
   * non-positive for contributors (they only ever drag the score down). For a
   * miss it is the recency-weighted share of the availability penalty; for a
   * slow verdict it is the even share of the latency-quality penalty.
   */
  impact: number;
}

export interface InsufficientDataScore {
  status: "insufficient_data";
  operatorId: string;
  formulaVersion: string;
  windowStart: number;
  windowEnd: number;
  /** Verdicts actually present in the window. */
  samples: number;
  minSamples: number;
}

export interface ScoredScore {
  status: "scored";
  operatorId: string;
  formulaVersion: string;
  /** Integer score in `[0, 1000]`. */
  score: number;
  windowStart: number;
  windowEnd: number;
  samples: number;
  /** Component metrics that produced the score (for transparency). */
  components: {
    /** Recency-weighted availability, `[0, 1]`. */
    availability: number;
    /** Recency-weighted miss rate, `[0, 1]`. */
    missRate: number;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    /** Latency quality, `[0, 1]` (1 when p95 <= target). */
    latencyQuality: number;
  };
  /** The verdicts that determined the score - the basis for attribution. */
  contributors: ScoreContributor[];
}

export type OperatorScore = InsufficientDataScore | ScoredScore;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampScore(x: number): number {
  return x < 0 ? 0 : x > 1000 ? 1000 : x;
}

/**
 * Recency weight for a verdict aged `ageMs` given half-life `halfLifeMs`:
 * `0.5 ** (ageMs / halfLifeMs)`. A verdict exactly at `asOf` has weight `1`.
 */
function recencyWeight(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Score one operator from its verdicts.
 *
 * @param verdicts All verdicts (any operator). Verdicts for other operators and
 *   verdicts outside the window are ignored.
 * @param asOf The reference time (epoch ms) for the sliding window. Scores are
 *   comparable only when computed against the same `asOf` convention; in
 *   production this is "now" at compute time.
 *
 * @throws RangeError if `config.formulaVersion` does not match
 *   {@link SCORE_FORMULA_VERSION}.
 */
export function scoreOperator(
  verdicts: readonly Verdict[],
  operatorId: string,
  config: ScoreConfig,
  asOf: number,
): OperatorScore {
  if (config.formulaVersion !== SCORE_FORMULA_VERSION) {
    throw new RangeError(
      `[worker-core] scoreOperator: config.formulaVersion "${config.formulaVersion}" ` +
        `does not match SCORE_FORMULA_VERSION "${SCORE_FORMULA_VERSION}". ` +
        `Bump the constant and re-stamp rather than mixing versions.`,
    );
  }

  const selection: WindowSelection = selectWindow(verdicts, operatorId, config.windowMs, asOf);
  const metrics: WindowMetrics = computeWindowMetrics(selection);

  if (metrics.total < config.minSamples) {
    return {
      status: "insufficient_data",
      operatorId,
      formulaVersion: SCORE_FORMULA_VERSION,
      windowStart: selection.windowStart,
      windowEnd: selection.windowEnd,
      samples: metrics.total,
      minSamples: config.minSamples,
    };
  }

  const weights = config.weights ?? { ...DEFAULT_WEIGHTS };
  const totalWeightScale = weights.availability + weights.latency;
  const availScale = totalWeightScale === 0 ? 0 : weights.availability / totalWeightScale;
  const latencyScale = totalWeightScale === 0 ? 0 : weights.latency / totalWeightScale;

  // Recency-weighted availability and miss-rate.
  let successWeight = 0;
  let missWeight = 0;
  for (const v of selection.verdicts) {
    const w = recencyWeight(asOf - v.at, config.halfLifeMs);
    if (v.outcome === "success") {
      successWeight += w;
    } else {
      missWeight += w;
    }
  }
  const totalWeight = successWeight + missWeight;
  const availability = totalWeight === 0 ? 0 : successWeight / totalWeight;
  const missRate = totalWeight === 0 ? 0 : missWeight / totalWeight;

  // Latency quality from p95 against the SLO target.
  const p95 = metrics.latencyP95Ms;
  const latencyQuality =
    p95 === null
      ? 0
      : clamp01(1 - Math.max(0, p95 - config.latencyTargetMs) / config.latencyTargetMs);

  const base = clampScore(1000 * (availScale * availability + latencyScale * latencyQuality));

  // Attribution: split each dimension's penalty across the verdicts that caused
  // it, in proportion to their recency weight (misses) or evenly (slow latencies).
  const contributors: ScoreContributor[] = [];

  const missPenaltyPoints = 1000 * availScale * (1 - availability); // always >= 0
  if (missWeight > 0) {
    for (const v of selection.verdicts) {
      if (v.outcome !== "success") {
        const w = recencyWeight(asOf - v.at, config.halfLifeMs);
        const impact = -((w / missWeight) * missPenaltyPoints);
        contributors.push({ verdict: v, reason: "miss", impact });
      }
    }
  }

  const slowVerdicts: Verdict[] = [];
  if (p95 !== null) {
    for (const v of selection.verdicts) {
      if (v.outcome === "success" && v.latencyMs > config.latencyTargetMs) {
        slowVerdicts.push(v);
      }
    }
  }
  if (slowVerdicts.length > 0) {
    const slowPenaltyPoints = 1000 * latencyScale * (1 - latencyQuality); // always >= 0
    const perSlow = slowPenaltyPoints / slowVerdicts.length;
    for (const v of slowVerdicts) {
      contributors.push({ verdict: v, reason: "slow", impact: -perSlow });
    }
  }

  return {
    status: "scored",
    operatorId,
    formulaVersion: SCORE_FORMULA_VERSION,
    score: Math.round(base),
    windowStart: selection.windowStart,
    windowEnd: selection.windowEnd,
    samples: metrics.total,
    components: {
      availability,
      missRate,
      latencyP50Ms: metrics.latencyP50Ms,
      latencyP95Ms: metrics.latencyP95Ms,
      latencyQuality,
    },
    contributors,
  };
}

/**
 * Explain a score drop: return the verdicts that are present in `after`'s
 * contributors but not in `before`'s. This is the product-level attribution -
 * "your score fell because of these verdicts" - and it works purely by
 * diffing two recomputations (e.g. `asOf` moved forward and a new miss landed).
 *
 * Returns `[]` if either side is not `scored` (e.g. one is `insufficient_data`).
 */
export function attributableDrop(before: OperatorScore, after: OperatorScore): Verdict[] {
  if (before.status !== "scored" || after.status !== "scored") {
    return [];
  }
  const beforeIds = new Set(before.contributors.map((c) => c.verdict.id));
  const dropped: Verdict[] = [];
  for (const c of after.contributors) {
    if (!beforeIds.has(c.verdict.id)) {
      dropped.push(c.verdict);
    }
  }
  return dropped;
}
