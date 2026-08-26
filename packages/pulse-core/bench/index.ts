/**
 * Benchmark entry point.
 *
 *   tsx bench/index.ts            run the suite and gate against bench/baseline.json
 *   tsx bench/index.ts --update   run the suite and (re)write bench/baseline.json
 *   tsx bench/index.ts --json     print the run report as JSON to stdout, no gating
 *
 * The gate exits non-zero when any case regresses beyond the threshold or a
 * baselined case goes missing, which is what fails the CI job. Updating the
 * baseline is deliberate and manual: a PR that moves it must justify the move in
 * its body, per the process documented in docs/ARCHITECTURE.md.
 */
import { cpus, totalmem, platform, arch } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAll, type BenchResult } from "./harness.js";
import { buildCases } from "./cases.js";
import {
  gate,
  formatGate,
  REGRESSION_THRESHOLD,
  type BenchReport,
  type BenchEnvironment,
} from "./gate.js";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(here, "baseline.json");

function captureEnvironment(): BenchEnvironment {
  const cores = cpus();
  return {
    platform: `${platform()} ${arch()}`,
    node: process.version,
    cpu: cores[0]?.model.trim() ?? "unknown",
    cores: cores.length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
  };
}

function toReport(results: BenchResult[]): BenchReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: captureEnvironment(),
    results: Object.fromEntries(results.map((r) => [r.name, r])),
  };
}

function readBaseline(): BenchReport | null {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BenchReport;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const update = args.has("--update");
  const jsonOnly = args.has("--json");

  process.stderr.write("pulse-core benchmarks\n");
  const results = await runAll(buildCases());
  const report = toReport(results);

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  if (update) {
    writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n");
    process.stderr.write(`\nBaseline written to ${BASELINE_PATH}\n`);
    process.stderr.write(
      "Remember: a committed baseline change must be justified in the PR body.\n",
    );
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    process.stderr.write(
      "\nNo baseline found. Seed one with:\n  pnpm --filter @orbital-stellar/pulse-core bench:update\n",
    );
    process.exit(1);
  }

  const outcome = gate(report, baseline, REGRESSION_THRESHOLD);
  process.stderr.write("\n" + formatGate(outcome, REGRESSION_THRESHOLD) + "\n");
  process.exit(outcome.passed ? 0 : 1);
}

main();
