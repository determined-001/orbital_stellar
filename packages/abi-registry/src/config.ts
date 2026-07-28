import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contract entry in the orbital codegen manifest.
 */
export type CodegenContract = {
  /** Soroban contract ID (C... format). */
  contractId: string;
  /** Optional local name for the generated output file. Defaults to contractId. */
  name?: string;
};

/**
 * Orbital codegen configuration, compatible with the `orbital.config.ts`
 * manifest from issue 10.4.
 */
export type OrbitalCodegenConfig = {
  /** Contract entries to generate types for. */
  contracts: CodegenContract[];
  /** Output directory for generated files. */
  outDir: string;
  /** Soroban RPC endpoint for on-chain spec resolution. */
  rpcUrl?: string;
  /** Registry contract ID for on-chain ABI registry lookups. */
  registryContractId?: string;
  /** Publisher address to resolve specs under. */
  registryPublisher?: string;
  /** Network passphrase. */
  networkPassphrase?: string;
};

/**
 * Lock file entry tracking the resolved spec hash per contract.
 * Written as `orbital.lock.json` alongside the config.
 */
export type OrbitalLockEntry = {
  /** sha256 hex of the resolved ContractSpec JSON. */
  specHash: string;
  /** When this hash was last verified (ISO 8601). */
  verifiedAt: string;
};

export type OrbitalLockFile = Record<string, OrbitalLockEntry>;

const LOCK_FILE_NAME = "orbital.lock.json";
const CONFIG_FILE_NAMES = ["orbital.config.ts", "orbital.config.js", "orbital.config.mjs"];

/**
 * Loads orbital codegen config from the working directory.
 */
export function loadCodegenConfig(cwd: string): {
  config: OrbitalCodegenConfig | null;
  lockFile: OrbitalLockFile | null;
  errors: string[];
} {
  const errors: string[] = [];

  const configPath = CONFIG_FILE_NAMES.map((name) => resolve(cwd, name)).find((p) =>
    existsSync(p),
  );

  if (!configPath) {
    return { config: null, lockFile: null, errors: ["orbital config not found"] };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const jsonStr = raw
      .replace(/^export\s+default\s+/gm, "")
      .replace(/^export\s+const\s+\w+\s*=\s*/gm, "")
      .replace(/as\s+\w+/g, "")
      .replace(/;\s*$/, "")
      .trim();
    const parsed = JSON.parse(jsonStr) as OrbitalCodegenConfig;
    return { config: parsed, lockFile: loadLockFile(cwd), errors: [] };
  } catch {
    errors.push(
      "Failed to parse config. Once 10.4 ships, use defineConfig() in orbital.config.ts.",
    );
  }

  return { config: null, lockFile: null, errors };
}

export function loadLockFile(cwd: string): OrbitalLockFile | null {
  const lockPath = resolve(cwd, LOCK_FILE_NAME);
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8")) as OrbitalLockFile;
  } catch {
    return null;
  }
}
