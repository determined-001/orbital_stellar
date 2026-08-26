/**
 * Regression gate: compares a fresh benchmark run against the committed
 * baseline and decides whether the build passes.
 *
 * A case fails when its throughput drops by more than {@link REGRESSION_THRESHOLD}
 * relative to the baseline. Improvements never fail. Cases present in the run but
 * missing from the baseline are reported as "new" (not a failure); cases in the
 * baseline but missing from the run are reported as "missing" (a failure, because
 * a silently dropped benchmark is how coverage rots).
 */
import type { BenchResult } from "./harness.js";

/** A regression worse than this fraction fails the build. 0.20 == 20%. */
export const REGRESSION_THRESHOLD = 0.2;

/** The on-disk shape of both the baseline file and a fresh run's output. */
export interface BenchReport {
  /** Schema version, so a future format change can be detected rather than silently misread. */
  schemaVersion: 1;
  /** ISO 8601 timestamp of when the run was produced. */
  generatedAt: string;
  /** The hardware and runtime the numbers were measured on. Recorded so a baseline is interpretable. */
  environment: BenchEnvironment;
  /** Results keyed by case name for stable lookup regardless of run order. */
  results: Record<string, BenchResult>;
}

/** Machine context captured alongside results so a baseline means something. */
export interface BenchEnvironment {
  /** e.g. "linux x64". */
  platform: string;
  /** Node version string, e.g. "v22.22.2". */
  node: string;
  /** CPU model string, first core. */
  cpu: string;
  /** Number of logical cores. */
  cores: number;
  /** Total system memory in GB, rounded. */
  memoryGb: number;
  /** Free-form note. The placeholder baseline sets this so a reader knows to regenerate it. */
  note?: string;
}

/** One case's verdict after comparison. */
export interface GateEntry {
  name: string;
  /** "ok" | "improved" | "regressed" | "new" | "missing". */
  status: "ok" | "improved" | "regressed" | "new" | "missing";
  /** Baseline ops/sec, or null when the case is new. */
  baselineHz: number | null;
  /** Current ops/sec, or null when the case is missing from the run. */
  currentHz: number | null;
  /** Signed relative change vs baseline (positive == faster), or null when not comparable. */
  delta: number | null;
}

/** The full gate outcome. */
export interface GateOutcome {
  passed: boolean;
  entries: GateEntry[];
}

/**
 * Compares a run against a baseline and produces a pass/fail outcome plus a
 * per-case breakdown. Pure and side-effect-free so it is trivially testable.
 *
 * A case is only marked "regressed" when it is slower than the baseline by more
 * than `threshold`. The comparison is on throughput (`hz`), so higher is always
 * better and the sign of `delta` reads naturally: negative means slower.
 */
export function gate(
  current: BenchReport,
  baseline: BenchReport,
  threshold: number = REGRESSION_THRESHOLD,
): GateOutcome {
  const entries: GateEntry[] = [];
  const names = new Set([...Object.keys(baseline.results), ...Object.keys(current.results)]);

  for (const name of [...names].sort()) {
    const base = baseline.results[name];
    const cur = current.results[name];

    if (base && !cur) {
      entries.push({ name, status: "missing", baselineHz: base.hz, currentHz: null, delta: null });
      continue;
    }
    if (!base && cur) {
      entries.push({ name, status: "new", baselineHz: null, currentHz: cur.hz, delta: null });
      continue;
    }
    if (!base || !cur) continue;

    const delta = base.hz === 0 ? 0 : (cur.hz - base.hz) / base.hz;

    let status: GateEntry["status"];
    if (delta < -threshold) status = "regressed";
    else if (delta > threshold) status = "improved";
    else status = "ok";

    entries.push({ name, status, baselineHz: base.hz, currentHz: cur.hz, delta });
  }

  const passed = !entries.some((e) => e.status === "regressed" || e.status === "missing");
  return { passed, entries };
}

/** Renders a gate outcome as an aligned text table for CI logs. */
export function formatGate(outcome: GateOutcome, threshold: number = REGRESSION_THRESHOLD): string {
  const lines: string[] = [];
  const pct = (n: number | null): string =>
    n === null ? "     -" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const hz = (n: number | null): string => (n === null ? "-" : `${(n / 1000).toFixed(1)}K`);

  const nameWidth = Math.max(4, ...outcome.entries.map((e) => e.name.length));
  const header = `${"case".padEnd(nameWidth)}  ${"baseline".padStart(10)}  ${"current".padStart(10)}  ${"delta".padStart(8)}  status`;
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const e of outcome.entries) {
    lines.push(
      `${e.name.padEnd(nameWidth)}  ${hz(e.baselineHz).padStart(10)}  ${hz(e.currentHz).padStart(10)}  ${pct(e.delta).padStart(8)}  ${e.status}`,
    );
  }

  lines.push("");
  lines.push(
    outcome.passed
      ? `PASS - no case regressed beyond ${(threshold * 100).toFixed(0)}%.`
      : `FAIL - a case regressed beyond ${(threshold * 100).toFixed(0)}% or went missing.`,
  );
  if (outcome.entries.some((e) => e.status === "new")) {
    lines.push("Note: new cases are not gated until their numbers are committed to the baseline.");
  }
  return lines.join("\n");
}
