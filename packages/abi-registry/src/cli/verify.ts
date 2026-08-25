/**
 * CLI surface for {@link verifySchema}: reads a submitted schema off disk,
 * compares it against the deployed contract's on-chain spec, and renders the
 * structured verdict as either human-readable text or JSON.
 *
 * The command itself lives in `bin/abi-registry`; everything here is pure
 * enough to test without spawning a process - `runVerify` returns the streams
 * and exit code it wants rather than writing to `process.stdout` or calling
 * `process.exit`.
 */

import { readFileSync } from "node:fs";
import { validateSpec } from "../spec.js";
import type { ContractSpec } from "../spec.js";
import { verifySchema } from "../verifySchema.js";
import type { SchemaVerdict } from "../verifySchema.js";
import { wellKnownToContractSpec } from "../wellKnown.js";
import type { WellKnownSpecRaw } from "../wellKnown.js";

/**
 * Process exit codes, kept distinct so CI can gate on a specific outcome
 * rather than only on "non-zero".
 */
export const VERIFY_EXIT_CODES = {
  /** Submitted schema matches the on-chain spec. */
  match: 0,
  /** Submitted schema disagrees with the on-chain spec - the CI-gating case. */
  mismatch: 1,
  /** Contract has no embedded spec, so nothing could be compared. */
  unverifiable: 2,
  /** Bad usage, unreadable schema file, or an RPC/network failure. */
  error: 3,
} as const;

/** Options accepted by {@link runVerify}, mirroring the CLI flags one-for-one. */
export type VerifyCliOptions = {
  /** Soroban contract ID (C...) to verify against. */
  contractId: string;
  /** Path to the submitted schema JSON file (`--schema`). */
  schemaPath: string;
  /** Soroban RPC endpoint to read the deployed contract from. */
  rpcUrl: string;
  /** Network the contract is deployed on. */
  network?: "mainnet" | "testnet" | "futurenet";
  /** Emit the verdict as JSON instead of human-readable text. */
  json?: boolean;
  /** Treat an `unverifiable` verdict as success (exit 0) instead of exit 2. */
  allowUnverifiable?: boolean;
};

/** What {@link runVerify} decided, without having touched the process. */
export type VerifyCliResult = {
  /** Exit code the caller should exit with - see {@link VERIFY_EXIT_CODES}. */
  exitCode: number;
  /** Text destined for stdout (empty when nothing should be printed). */
  stdout: string;
  /** Text destined for stderr (diagnostics and failures). */
  stderr: string;
};

/** Seams {@link runVerify} reaches the outside world through, injectable for tests. */
export type VerifyCliDeps = {
  /** Reads the submitted schema file as UTF-8 text. */
  readFile?: (path: string) => string;
  /** Performs the actual comparison - defaults to {@link verifySchema}. */
  verify?: typeof verifySchema;
};

function isWellKnownRaw(value: unknown): value is WellKnownSpecRaw {
  return typeof value === "object" && value !== null && "contract_id" in value;
}

/**
 * Loads a submitted schema from disk.
 *
 * Accepts either the canonical {@link ContractSpec} shape or the hand-authored
 * snake_case well-known format (`specs/well-known/*.json`), so the bundled
 * well-known specs can be passed to `--schema` directly.
 *
 * @throws Error if the file is unreadable, isn't JSON, or isn't a valid spec.
 */
export function loadSubmittedSchema(
  schemaPath: string,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf-8"),
): ContractSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(readFile(schemaPath));
  } catch (error) {
    throw new Error(
      `Could not read schema file "${schemaPath}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const spec = isWellKnownRaw(raw) ? wellKnownToContractSpec(raw) : (raw as ContractSpec);

  const validation = validateSpec(spec);
  if (!validation.valid) {
    throw new Error(
      `Schema file "${schemaPath}" is not a valid ContractSpec:\n  - ${validation.errors.join("\n  - ")}`,
    );
  }

  return spec;
}

function formatValue(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

/**
 * Renders a verdict for a terminal. JSON output is handled by
 * {@link runVerify} directly, since it is just the verdict plus the contract ID.
 */
export function formatVerdict(contractId: string, verdict: SchemaVerdict): string {
  if (verdict.status === "match") {
    return [
      `✓ match  ${contractId}`,
      "  Submitted schema matches the contract's on-chain spec.",
    ].join("\n");
  }

  if (verdict.status === "unverifiable") {
    return [`? unverifiable  ${contractId}`, `  ${verdict.reason}`].join("\n");
  }

  const lines = [
    `✗ mismatch  ${contractId}`,
    `  ${verdict.diffs.length} difference(s) between the submitted schema and the on-chain spec:`,
    "",
  ];
  for (const diff of verdict.diffs) {
    lines.push(`  - ${diff.path}`);
    lines.push(`      submitted: ${formatValue(diff.submitted)}`);
    lines.push(`      on-chain:  ${formatValue(diff.onChain)}`);
  }
  return lines.join("\n");
}

/**
 * Runs `abi-registry verify`: loads the submitted schema, compares it against
 * the deployed contract, and returns the rendered output plus the exit code.
 *
 * Never throws for an expected failure (unreadable schema, RPC error) - those
 * come back as {@link VERIFY_EXIT_CODES.error} with the reason on stderr.
 */
export async function runVerify(
  options: VerifyCliOptions,
  deps: VerifyCliDeps = {},
): Promise<VerifyCliResult> {
  const verify = deps.verify ?? verifySchema;

  let submitted: ContractSpec;
  try {
    submitted = loadSubmittedSchema(options.schemaPath, deps.readFile);
  } catch (error) {
    return {
      exitCode: VERIFY_EXIT_CODES.error,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }

  let verdict: SchemaVerdict;
  try {
    verdict = await verify(options.contractId, submitted, {
      rpcUrl: options.rpcUrl,
      ...(options.network ? { network: options.network } : {}),
    });
  } catch (error) {
    return {
      exitCode: VERIFY_EXIT_CODES.error,
      stdout: "",
      stderr: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const exitCode =
    verdict.status === "unverifiable" && options.allowUnverifiable
      ? VERIFY_EXIT_CODES.match
      : VERIFY_EXIT_CODES[verdict.status];

  const stdout = options.json
    ? JSON.stringify({ contractId: options.contractId, ...verdict }, null, 2)
    : formatVerdict(options.contractId, verdict);

  return { exitCode, stdout, stderr: "" };
}
