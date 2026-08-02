import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { LockFile, LockFileContract, OrbitalLockFile } from "./config.js";
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
    const parsedLockFile = JSON.parse(content) as unknown;

    if (isLockFile(parsedLockFile)) {
      return parsedLockFile;
    }

    if (isLegacyLockFile(parsedLockFile)) {
      return upgradeLegacyLockFile(parsedLockFile);
    }

    if (!parsedLockFile || typeof parsedLockFile !== "object") {
      throw new LockFileError(`Invalid lock file format: ${lockPath}`, lockPath);
    }

    throw new LockFileError(`Invalid lock file format: ${lockPath}`, lockPath);
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

  const matchedLockedContracts = new Set<LockFileContract>();

  const lockContractById = new Map(
    lockFile.contracts.map((contract) => [contract.contractId, contract]),
  );
  const lockContractByName = new Map(
    lockFile.contracts.map((contract) => [contract.name, contract]),
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
  const currentContractNames = new Set(
    contracts.map(({ config }) => config.name || config.contractId),
  );

  // Check for added or modified contracts
  for (const [contractId, current] of currentContractMap) {
    const locked = lockContractById.get(contractId) ?? lockContractByName.get(current.name);

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
    } else {
      matchedLockedContracts.add(locked);
    }
  }

  // Check for removed contracts
  for (const locked of lockFile.contracts) {
    if (
      !matchedLockedContracts.has(locked) &&
      !currentContractMap.has(locked.contractId) &&
      !currentContractNames.has(locked.name)
    ) {
      contractChanges.push({
        contractId: locked.contractId,
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

function isLockFile(value: unknown): value is LockFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LockFile>;
  return (
    candidate.version === "1.0.0" &&
    typeof candidate.configHash === "string" &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.contracts) &&
    candidate.contracts.every(
      (contract) =>
        contract &&
        typeof contract === "object" &&
        typeof contract.contractId === "string" &&
        typeof contract.name === "string" &&
        typeof contract.specHash === "string" &&
        typeof contract.resolvedAt === "string" &&
        (contract.source === "registry" || contract.source === "wasm"),
    )
  );
}

function isLegacyLockFile(value: unknown): value is OrbitalLockFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { specHash?: unknown }).specHash === "string" &&
      typeof (entry as { verifiedAt?: unknown }).verifiedAt === "string",
  );
}

function upgradeLegacyLockFile(lockFile: OrbitalLockFile): LockFile {
  const entries = Object.entries(lockFile);
  const generatedAt =
    entries.reduce<string | null>((latest, [, entry]) => {
      if (!latest || entry.verifiedAt > latest) {
        return entry.verifiedAt;
      }
      return latest;
    }, null) ?? new Date().toISOString();

  return {
    version: "1.0.0",
    configHash: "legacy",
    contracts: entries.map(([name, entry]) => ({
      contractId: name,
      name,
      specHash: entry.specHash,
      resolvedAt: entry.verifiedAt,
      source: "registry",
    })),
    generatedAt,
  };
}
