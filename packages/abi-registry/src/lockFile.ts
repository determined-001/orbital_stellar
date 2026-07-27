import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { LockFile, LockFileContract, OrbitalConfig } from "./config.js";
import type { ContractSpec } from "./spec.js";

/**
 * Error thrown when lock file operations fail
 */
export class LockFileError extends Error {
  constructor(
    message: string,
    public path?: string,
  ) {
    super(message);
    this.name = "LockFileError";
  }
}

/**
 * Loads an existing lock file from disk
 */
export function loadLockFile(lockPath: string): LockFile | null {
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const content = readFileSync(lockPath, "utf-8");
    const lockFile = JSON.parse(content) as LockFile;

    // Validate lock file structure
    if (!lockFile.version || !lockFile.contracts || !Array.isArray(lockFile.contracts)) {
      throw new LockFileError(`Invalid lock file format: ${lockPath}`, lockPath);
    }

    return lockFile;
  } catch (error) {
    if (error instanceof LockFileError) {
      throw error;
    }
    throw new LockFileError(
      `Failed to read lock file: ${error instanceof Error ? error.message : String(error)}`,
      lockPath,
    );
  }
}

/**
 * Saves a lock file to disk
 */
export function saveLockFile(lockPath: string, lockFile: LockFile): void {
  try {
    const content = JSON.stringify(lockFile, null, 2);
    writeFileSync(lockPath, content, "utf-8");
  } catch (error) {
    throw new LockFileError(
      `Failed to write lock file: ${error instanceof Error ? error.message : String(error)}`,
      lockPath,
    );
  }
}

/**
 * Creates a new lock file from config and resolved contracts
 */
export function createLockFile(
  configHash: string,
  contracts: Array<{
    config: { contractId: string; name?: string };
    spec: ContractSpec;
    source: "registry" | "wasm";
  }>,
): LockFile {
  const lockContracts: LockFileContract[] = contracts.map(({ config, spec, source }) => ({
    contractId: config.contractId,
    name: config.name || config.contractId,
    specHash: generateSpecHash(spec),
    resolvedAt: new Date().toISOString(),
    source,
  }));

  return {
    version: "1.0.0",
    configHash,
    contracts: lockContracts,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a hash of a contract spec for change detection
 */
export function generateSpecHash(spec: ContractSpec): string {
  // Create a normalized spec for hashing (exclude volatile fields like timestamps)
  const normalizedSpec = {
    name: spec.name,
    contractId: spec.contractId,
    network: spec.network,
    functions: spec.functions,
    events: spec.events,
    types: spec.types,
    // Exclude xdrEntries as they can be large and functions/events/types capture the essence
  };

  const specString = JSON.stringify(normalizedSpec, Object.keys(normalizedSpec).sort());
  return createHash("sha256").update(specString).digest("hex");
}

/**
 * Compares current config and specs with lock file to detect changes
 */
export function detectDrift(
  lockFile: LockFile,
  configHash: string,
  contracts: Array<{
    config: { contractId: string; name?: string };
    spec: ContractSpec;
    source: "registry" | "wasm";
  }>,
): {
  hasChanges: boolean;
  configChanged: boolean;
  contractChanges: Array<{
    contractId: string;
    name: string;
    change: "added" | "removed" | "modified";
    oldHash?: string;
    newHash?: string;
  }>;
} {
  const configChanged = lockFile.configHash !== configHash;
  const contractChanges: Array<{
    contractId: string;
    name: string;
    change: "added" | "removed" | "modified";
    oldHash?: string;
    newHash?: string;
  }> = [];

  // Create maps for easier comparison
  const lockContractMap = new Map(
    lockFile.contracts.map((contract) => [contract.contractId, contract]),
  );
  const currentContractMap = new Map(
    contracts.map(({ config, spec, source }) => [
      config.contractId,
      {
        name: config.name || config.contractId,
        specHash: generateSpecHash(spec),
        source,
      },
    ]),
  );

  // Check for added or modified contracts
  for (const [contractId, current] of currentContractMap) {
    const locked = lockContractMap.get(contractId);

    if (!locked) {
      contractChanges.push({
        contractId,
        name: current.name,
        change: "added",
        newHash: current.specHash,
      });
    } else if (locked.specHash !== current.specHash) {
      contractChanges.push({
        contractId,
        name: current.name,
        change: "modified",
        oldHash: locked.specHash,
        newHash: current.specHash,
      });
    }
  }

  // Check for removed contracts
  for (const [contractId, locked] of lockContractMap) {
    if (!currentContractMap.has(contractId)) {
      contractChanges.push({
        contractId,
        name: locked.name,
        change: "removed",
        oldHash: locked.specHash,
      });
    }
  }

  return {
    hasChanges: configChanged || contractChanges.length > 0,
    configChanged,
    contractChanges,
  };
}

/**
 * Gets the default lock file path relative to config directory
 */
export function getLockFilePath(configDirectory: string): string {
  return resolve(configDirectory, "orbital.lock.json");
}

/**
 * Formats drift detection results for CI-friendly output
 */
export function formatDriftReport(drift: ReturnType<typeof detectDrift>): string {
  const lines: string[] = [];

  if (!drift.hasChanges) {
    lines.push("✓ No changes detected - lock file is up to date");
    return lines.join("\n");
  }

  lines.push("✗ Changes detected in orbital configuration:");

  if (drift.configChanged) {
    lines.push("  • Configuration changed");
  }

  if (drift.contractChanges.length > 0) {
    lines.push(`  • ${drift.contractChanges.length} contract changes:`);

    for (const change of drift.contractChanges) {
      switch (change.change) {
        case "added":
          lines.push(`    + ${change.name} (${change.contractId})`);
          break;
        case "removed":
          lines.push(`    - ${change.name} (${change.contractId})`);
          break;
        case "modified":
          lines.push(`    ~ ${change.name} (${change.contractId})`);
          lines.push(`      Old hash: ${change.oldHash?.substring(0, 12)}...`);
          lines.push(`      New hash: ${change.newHash?.substring(0, 12)}...`);
          break;
      }
    }
  }

  return lines.join("\n");
}
