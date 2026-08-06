/**
 * Minimal, dependency-free benchmark harness built on `node:perf_hooks`.
 *
 * The suite avoids a third-party benchmark runner on purpose: CI installs with
 * `--frozen-lockfile`, so every case here has to run from the standard library
 * alone, with no lockfile churn and no new supply-chain surface.
 *
 * Stability is the whole point of a gate. A benchmark that swings run-to-run
 * produces false regressions, and a gate that cries wolf gets muted within a
 * week. Three choices keep the noise down:
 *   - the headline figure is the **median** per-operation time, so a single GC
 *     pause or scheduler hiccup in one sample cannot drag the number;
 *   - each sample times a **calibrated batch** sized so the batch runs for a
 *     target duration, amortizing clock resolution across many calls;
 *   - the relative inter-quartile range travels with every result, so a caller
 *     (and the committed baseline) can see how trustworthy each number is.
 */
import { performance } from "node:perf_hooks";

/** A single thing to measure. `fn` runs once per iteration. */
export interface BenchCase {
  /** Stable identifier. This is the key the baseline is matched on, so it must not change casually. */
  name: string;
  /** The operation under test. Sync by default; async cases are awaited each iteration (see `async`). */
  fn: () => void | Promise<unknown>;
  /** Optional one-time setup run before sampling; its cost is never counted. */
  setup?: () => void;
  /** When true, each iteration is awaited. Use for cases whose real cost includes settling a promise. */
  async?: boolean;
}

/** The measured result for one case. All times are in nanoseconds per operation. */
export interface BenchResult {
  name: string;
  /** Operations per second, derived from the median. This is the headline number the gate reads. */
  hz: number;
  /** Median time per operation, in nanoseconds. Robust to outlier samples. */
  medianNs: number;
  /** Mean time per operation, in nanoseconds. Kept for context; not gated on. */
  meanNs: number;
  /** 75th-percentile time per operation, in nanoseconds. */
  p75Ns: number;
  /** 99th-percentile time per operation, in nanoseconds. */
  p99Ns: number;
  /** Relative inter-quartile range ((p75-p25)/median). A spread indicator; smaller is steadier. */
  riqr: number;
  /** How many timed samples were collected. */
  samples: number;
  /** Iterations per timed sample actually used (after auto-calibration). */
  batchSize: number;
}

/** Tuning knobs. Defaults keep a full run near a handful of seconds while staying steady. */
export interface RunOptions {
  /** Wall-clock budget, in ms, spent warming up before sampling. Lets the JIT settle. */
  warmupMs?: number;
  /** Number of timed samples to collect. More samples tighten the median. */
  samples?: number;
  /** Target time per sample, in ms. The batch is grown until one sample runs at least this long. */
  targetSampleMs?: number;
  /** Minimum iterations per sample, regardless of calibration. Guards slow ops against tiny batches. */
  minBatchSize?: number;
  /** Upper bound on batch auto-scaling, so a pathologically fast op can't spin forever. */
  maxBatchSize?: number;
}

const DEFAULTS: Required<RunOptions> = {
  warmupMs: 300,
  samples: 60,
  targetSampleMs: 25,
  minBatchSize: 256,
  maxBatchSize: 5_000_000,
};

function quantile(sortedNs: number[], q: number): number {
  if (sortedNs.length === 0) return 0;
  const idx = Math.min(sortedNs.length - 1, Math.max(0, Math.floor(q * sortedNs.length)));
  return sortedNs[idx]!;
}

/** Reduces raw per-operation samples into the reported statistics. */
function summarize(name: string, perOpNs: number[], batchSize: number): BenchResult {
  const sorted = [...perOpNs].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const p99 = quantile(sorted, 0.99);
  const mean = perOpNs.reduce((a, b) => a + b, 0) / perOpNs.length;
  const riqr = median === 0 ? 0 : (p75 - p25) / median;
  return {
    name,
    hz: median === 0 ? 0 : 1_000_000_000 / median,
    medianNs: median,
    meanNs: mean,
    p75Ns: p75,
    p99Ns: p99,
    riqr,
    samples: perOpNs.length,
    batchSize,
  };
}

/**
 * Grows a batch size until one batch takes at least `targetSampleMs`, so each
 * timed sample spans enough work that clock resolution is negligible. Never
 * returns fewer than `minBatchSize`, which keeps slow operations (tens of
 * microseconds each) from calibrating down to a handful of noisy iterations.
 */
function calibrateBatch(fn: () => void | Promise<unknown>, opts: Required<RunOptions>): number {
  let batch = opts.minBatchSize;
  while (batch < opts.maxBatchSize) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) fn();
    const elapsed = performance.now() - start;
    if (elapsed >= opts.targetSampleMs) break;
    const factor = elapsed > 0 ? Math.max(2, Math.ceil(opts.targetSampleMs / elapsed)) : 2;
    batch = Math.min(opts.maxBatchSize, batch * factor);
  }
  return batch;
}

/**
 * Async twin of {@link calibrateBatch}. Awaits each iteration so promise
 * settling is part of the measured cost, which is what a real caller pays.
 */
async function calibrateBatchAsync(
  fn: () => void | Promise<unknown>,
  opts: Required<RunOptions>,
): Promise<number> {
  let batch = opts.minBatchSize;
  while (batch < opts.maxBatchSize) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) await fn();
    const elapsed = performance.now() - start;
    if (elapsed >= opts.targetSampleMs) break;
    const factor = elapsed > 0 ? Math.max(2, Math.ceil(opts.targetSampleMs / elapsed)) : 2;
    batch = Math.min(opts.maxBatchSize, batch * factor);
  }
  return batch;
}

/**
 * Runs one sync case and returns its statistics. The batch is calibrated to the
 * operation's speed, the function is warmed for a wall-clock budget, then
 * `samples` batches are timed. The median per-operation time becomes `hz`.
 */
export function runCase(bench: BenchCase, options: RunOptions = {}): BenchResult {
  const opts = { ...DEFAULTS, ...options };
  bench.setup?.();

  const batchSize = calibrateBatch(bench.fn, opts);

  const warmEnd = performance.now() + opts.warmupMs;
  while (performance.now() < warmEnd) {
    for (let i = 0; i < batchSize; i++) bench.fn();
  }

  const perOpNs: number[] = [];
  for (let s = 0; s < opts.samples; s++) {
    const start = performance.now();
    for (let i = 0; i < batchSize; i++) bench.fn();
    const elapsedMs = performance.now() - start;
    perOpNs.push((elapsedMs * 1_000_000) / batchSize);
  }

  return summarize(bench.name, perOpNs, batchSize);
}

/**
 * Runs one async case and returns its statistics. Identical in method to
 * {@link runCase}, but awaits every iteration so a case backed by an async API
 * (like a CursorStore) is measured settling its promise, not just scheduling it.
 */
export async function runCaseAsync(
  bench: BenchCase,
  options: RunOptions = {},
): Promise<BenchResult> {
  const opts = { ...DEFAULTS, ...options };
  bench.setup?.();

  const batchSize = await calibrateBatchAsync(bench.fn, opts);

  const warmEnd = performance.now() + opts.warmupMs;
  while (performance.now() < warmEnd) {
    for (let i = 0; i < batchSize; i++) await bench.fn();
  }

  const perOpNs: number[] = [];
  for (let s = 0; s < opts.samples; s++) {
    const start = performance.now();
    for (let i = 0; i < batchSize; i++) await bench.fn();
    const elapsedMs = performance.now() - start;
    perOpNs.push((elapsedMs * 1_000_000) / batchSize);
  }

  return summarize(bench.name, perOpNs, batchSize);
}

/** Runs a list of cases in order and returns their results. */
export async function runAll(cases: BenchCase[], options: RunOptions = {}): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  for (const c of cases) {
    process.stderr.write(`  running ${c.name} ... `);
    const result = c.async ? await runCaseAsync(c, options) : runCase(c, options);
    process.stderr.write(`${formatHz(result.hz)} (iqr ${(result.riqr * 100).toFixed(1)}%)\n`);
    results.push(result);
  }
  return results;
}

/** Formats an ops/sec figure for human-readable console output. */
export function formatHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M ops/s`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)}K ops/s`;
  return `${hz.toFixed(0)} ops/s`;
}
