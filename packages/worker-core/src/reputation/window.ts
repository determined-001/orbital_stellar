/**
 * Operator reputation - windowing and per-window metrics.
 *
 * A {@link Verdict} is the chain-derived record that an operator either
 * succeeded or missed an assigned job, with the latency of the success. It is
 * the single source of truth for scoring: everything downstream is recomputed
 * from these records, and the records themselves are tamper-resistant because
 * they are chain-derived and never operator self-reported (see
 * `docs/design/worker-reputation.md` and `ORBITAL_PRD.md` §C.6).
 *
 * This module is deliberately state-free: given the same verdicts and the same
 * window, it always returns the same metrics. There is no incremental
 * accumulator that can drift from its inputs.
 */

export type VerdictOutcome = "success" | "miss";

/**
 * One chain-derived judgment about an operator's performance on a single job.
 *
 * - `id` is a stable identifier (e.g. the verdict's on-chain event id) and is
 *   what attribution/diffing keys off of.
 * - `at` is a chain-derived timestamp in epoch milliseconds. It is never
 *   supplied by the operator, so it cannot be gamed to improve recency.
 * - `latencyMs` is meaningful only when `outcome === "success"`; for a miss it
 *   is ignored by the metrics.
 */
export interface Verdict {
  id: string;
  operatorId: string;
  at: number;
  outcome: VerdictOutcome;
  latencyMs: number;
}

export interface WindowSelection {
  operatorId: string;
  windowStart: number;
  windowEnd: number;
  /** Verdicts for the operator that fall inside `[windowStart, windowEnd]`,
   *  sorted ascending by `at`. */
  verdicts: Verdict[];
}

export interface WindowMetrics {
  operatorId: string;
  windowStart: number;
  windowEnd: number;
  /** Total verdicts in the window (the sample count). */
  total: number;
  successes: number;
  misses: number;
  /** Availability: `successes / total`, in `[0, 1]`. `0` when `total === 0`. */
  uptime: number;
  /** Miss rate: `misses / total`, in `[0, 1]`. `0` when `total === 0`. */
  missRate: number;
  /** p50 latency over successful verdicts (ms). `null` when no successes. */
  latencyP50Ms: number | null;
  /** p95 latency over successful verdicts (ms). `null` when no successes. */
  latencyP95Ms: number | null;
}

/**
 * Select the verdicts for `operatorId` that fall inside the sliding window
 * `[asOf - windowMs, asOf]`, sorted ascending by `at`.
 *
 * Verdicts for other operators are ignored. The input array is never mutated.
 */
export function selectWindow(
  verdicts: readonly Verdict[],
  operatorId: string,
  windowMs: number,
  asOf: number,
): WindowSelection {
  const windowStart = asOf - windowMs;
  const inWindow: Verdict[] = [];
  for (const v of verdicts) {
    if (v.operatorId === operatorId && v.at >= windowStart && v.at <= asOf) {
      inWindow.push(v);
    }
  }
  inWindow.sort((a, b) => a.at - b.at);
  return { operatorId, windowStart, windowEnd: asOf, verdicts: inWindow };
}

/**
 * Compute uptime, miss-rate, and p50/p95 latency for a window selection.
 *
 * Latency percentiles consider only successful verdicts. Percentiles use the
 * "linear interpolation between closest ranks" (R-7 / `PERCENTILE.INC`) method,
 * which is deterministic and documented in `docs/design/worker-reputation.md`.
 */
export function computeWindowMetrics(sel: WindowSelection): WindowMetrics {
  const total = sel.verdicts.length;
  let successes = 0;
  let misses = 0;
  const latencies: number[] = [];
  for (const v of sel.verdicts) {
    if (v.outcome === "success") {
      successes += 1;
      latencies.push(v.latencyMs);
    } else {
      misses += 1;
    }
  }
  const uptime = total === 0 ? 0 : successes / total;
  const missRate = total === 0 ? 0 : misses / total;
  latencies.sort((a, b) => a - b);
  const latencyP50Ms = latencies.length === 0 ? null : percentile(latencies, 0.5);
  const latencyP95Ms = latencies.length === 0 ? null : percentile(latencies, 0.95);
  return {
    operatorId: sel.operatorId,
    windowStart: sel.windowStart,
    windowEnd: sel.windowEnd,
    total,
    successes,
    misses,
    uptime,
    missRate,
    latencyP50Ms,
    latencyP95Ms,
  };
}

/**
 * Percentile via linear interpolation between closest ranks (R-7).
 *
 * `sorted` must be ascending and non-empty.
 */
export function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) {
    throw new RangeError("[worker-core] percentile requires a non-empty array");
  }
  if (p < 0 || p > 1 || Number.isNaN(p)) {
    throw new RangeError(`[worker-core] percentile p must be in [0, 1], got ${p}`);
  }
  if (n === 1) {
    return sorted[0] as number;
  }
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] as number;
  const hiVal = sorted[hi] as number;
  if (lo === hi) {
    return loVal;
  }
  const frac = idx - lo;
  return loVal + frac * (hiVal - loVal);
}
