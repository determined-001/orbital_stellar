import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { OrbitalConfig, ContractConfig } from "./config.js";
import type { ContractSpec } from "./spec.js";
import { generateContractTypes } from "./generate.js";
import { discoverContractSpec } from "./discovery/discoverContract.js";
import { OnChainAbiRegistryClient } from "./OnChainAbiRegistryClient.js";
import { Networks } from "@stellar/stellar-sdk";
import {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
} from "./registryConstants.js";
import {
  loadLockFile,
  saveLockFile,
  createLockFile,
  detectDrift,
  getLockFilePath,
  formatDriftReport,
} from "./lockFile.js";
import { getConfigDirectory } from "./configLoader.js";

/**
 * Error thrown when batch generation fails
 */
export class BatchGenerationError extends Error {
  constructor(
    message: string,
    public contractId?: string,
  ) {
    super(message);
    this.name = "BatchGenerationError";
  }
}

export interface BatchGenerationResult {
  contractsProcessed: number;
  contracts: Array<{
    contractId: string;
    name: string;
    outputPath: string;
    source: "registry" | "wasm";
  }>;
  lockFileUpdated: boolean;
}

/**
 * Evaluates whether a time-based trigger should fire based on the elapsed
 * time since the last run.
 */
export function evaluateTimeBasedTrigger(
  lastRunAt: number,
  intervalMs: number,
  now: number = Date.now(),
): boolean {
  if (intervalMs <= 0) {
    return true;
  }
  return now - lastRunAt >= intervalMs;
}

/**
 * Evaluator for time-based triggers that fire on a fixed interval.
 */
export class TimeBasedTriggerEvaluator {
  constructor(private readonly intervalMs: number) {}

  evaluate(lastRunAt: number, now: number = Date.now()): boolean {
    return evaluateTimeBasedTrigger(lastRunAt, this.intervalMs, now);
  }
}

/**
 * Generates TypeScript types for all contracts in the config
 */
export async function generateBatchTypes(
  config: OrbitalConfig,
  configHash: string,
  configPath: string,
): Promise<BatchGenerationResult> {
  const configDir = getConfigDirectory(configPath);
  const lockFilePath = getLockFilePath(configDir);

  // Validate config before processing
  try {
    validateBatchConfig(config, configDir);
  } catch (error) {
    if (error instanceof BatchGenerationError) {
      throw error;
    }
    throw new BatchGenerationError(
      `Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Ensure output directory exists
  const outDir = resolve(configDir, config.outDir);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    throw new BatchGenerationError(
      `Failed to create output directory '${config.outDir}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const results: BatchGenerationResult = {
    contractsProcessed: 0,
    contracts: [],
    lockFileUpdated: false,
  };

  const resolvedContracts: Array<{
    config: ContractConfig;
    spec: ContractSpec;
    source: "registry" | "wasm";
  }> = [];

  // Resolve all contract specs with detailed error context
  for (let i = 0; i < config.contracts.length; i++) {
    const contractConfig = config.contracts[i]!; // Safe to assert non-null since we're within array bounds
    try {
      const { spec, source } = await resolveContractSpec(config, contractConfig);
      resolvedContracts.push({ config: contractConfig, spec, source });
    } catch (error) {
      const contractName = contractConfig.name || contractConfig.contractId;
      throw new BatchGenerationError(
        `Failed to resolve contract '${contractName}' (contracts[${i}]): ${
          error instanceof Error ? error.message : String(error)
        }`,
        contractConfig.contractId,
      );
    }
  }

  // Generate types for each contract with detailed error context
  for (let i = 0; i < resolvedContracts.length; i++) {
    const { config: contractConfig, spec, source } = resolvedContracts[i]!; // Safe to assert non-null since we're within array bounds
    const contractName = contractConfig.name || contractConfig.contractId;
    const fileName = `${sanitizeFileName(contractName)}.ts`;
    const outputPath = join(outDir, fileName);

    try {
      const generatedTypes = generateContractTypes(spec);
      writeFileSync(outputPath, generatedTypes, "utf-8");

      results.contracts.push({
        contractId: contractConfig.contractId,
        name: contractName,
        outputPath,
        source,
      });
      results.contractsProcessed++;
    } catch (error) {
      throw new BatchGenerationError(
        `Failed to generate types for contract '${contractName}' (contracts[${i}]) to file '${fileName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        contractConfig.contractId,
      );
    }
  }

  // Update lock file with error handling
  try {
    const newLockFile = createLockFile(configHash, resolvedContracts);
    saveLockFile(lockFilePath, newLockFile);
    results.lockFileUpdated = true;
  } catch (error) {
    throw new BatchGenerationError(
      `Failed to update lock file '${lockFilePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return results;
}

/**
 * Checks for drift without writing files (for --check flag)
 */
export async function checkForDrift(
  config: OrbitalConfig,
  configHash: string,
  configPath: string,
): Promise<{ hasChanges: boolean; report: string }> {
  const configDir = getConfigDirectory(configPath);
  const lockFilePath = getLockFilePath(configDir);

  // Validate config before checking
  try {
    validateBatchConfig(config, configDir);
  } catch (error) {
    return {
      hasChanges: true,
      report: `✗ Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Load existing lock file
  let existingLockFile;
  try {
    existingLockFile = loadLockFile(lockFilePath);
  } catch (error) {
    return {
      hasChanges: true,
      report: `✗ Failed to load lock file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!existingLockFile) {
    return {
      hasChanges: true,
      report: "✗ No lock file found - run 'orbital codegen' to create one",
    };
  }

  // Create temporary directory for generation
  const tempDir = join(tmpdir(), `orbital-check-${randomBytes(8).toString("hex")}`);

  try {
    mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    return {
      hasChanges: true,
      report: `✗ Failed to create temporary directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    // Resolve current contract specs
    const resolvedContracts: Array<{
      config: ContractConfig;
      spec: ContractSpec;
      source: "registry" | "wasm";
    }> = [];

    for (let i = 0; i < config.contracts.length; i++) {
      const contractConfig = config.contracts[i]!; // Safe to assert non-null since we're within array bounds
      try {
        const { spec, source } = await resolveContractSpec(config, contractConfig);
        resolvedContracts.push({ config: contractConfig, spec, source });
      } catch (error) {
        const contractName = contractConfig.name || contractConfig.contractId;
        return {
          hasChanges: true,
          report: `✗ Failed to resolve contract '${contractName}' (contracts[${i}]): ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    // Detect drift
    const drift = detectDrift(existingLockFile, configHash, resolvedContracts);
    const report = formatDriftReport(drift);

    return {
      hasChanges: drift.hasChanges,
      report,
    };
  } finally {
    // Clean up temp directory
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Log cleanup error but don't fail the operation
      console.warn(
        `Warning: Failed to clean up temporary directory ${tempDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Validates the config for batch operations
 */
function validateBatchConfig(config: OrbitalConfig, configDir: string): void {
  // Check for empty contracts array
  if (config.contracts.length === 0) {
    throw new BatchGenerationError("Configuration must contain at least one contract");
  }

  // Validate outDir is accessible
  const outDir = resolve(configDir, config.outDir);
  try {
    // Try to create the directory to test permissions
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    throw new BatchGenerationError(
      `Output directory '${config.outDir}' cannot be created: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate contract names don't conflict with system files
  const reservedNames = ["index", "package", "node_modules", ".git", ".gitignore"];
  config.contracts.forEach((contract, index) => {
    const name = contract.name || contract.contractId;
    const sanitizedName = sanitizeFileName(name);

    if (reservedNames.includes(sanitizedName.toLowerCase())) {
      throw new BatchGenerationError(
        `Contract name '${name}' (contracts[${index}]) conflicts with reserved filename: ${sanitizedName}`,
      );
    }

    if (sanitizedName.length === 0) {
      throw new BatchGenerationError(
        `Contract name '${name}' (contracts[${index}]) produces empty filename after sanitization`,
      );
    }
  });
}

/**
 * Resolves a contract spec from registry or WASM
 */
async function resolveContractSpec(
  config: OrbitalConfig,
  contractConfig: ContractConfig,
): Promise<{ spec: ContractSpec; source: "registry" | "wasm" }> {
  const network = config.network || "testnet";
  const rpcUrl = config.rpcUrl || getDefaultRpcUrl(network);
  const networkPassphrase = getNetworkPassphrase(network);

  const registryContractId = config.registryContractId || ORBITAL_REGISTRY_TESTNET_CONTRACT_ID;
  const registryPublisher = config.registryPublisher || ORBITAL_REGISTRY_PUBLISHER_ADDRESS;

  // Validate RPC URL is accessible
  try {
    new URL(rpcUrl);
  } catch (error) {
    throw new Error(
      `Invalid RPC URL '${rpcUrl}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Try registry first if configured
  if (registryContractId) {
    try {
      const registryClient = new OnChainAbiRegistryClient({
        contractId: registryContractId,
        rpcUrl,
        networkPassphrase,
        publisher: registryPublisher,
      });

      const spec = await registryClient.getSpec(contractConfig.contractId);
      if (spec) {
        return { spec, source: "registry" };
      }
    } catch (error) {
      // Log warning but don't fail immediately - fall back to WASM
      console.warn(
        `[orbital codegen] Registry lookup failed for ${contractConfig.contractId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Fall back to WASM discovery
  try {
    const spec = await discoverContractSpec({
      rpcUrl,
      contractId: contractConfig.contractId,
      network,
    });
    return { spec, source: "wasm" };
  } catch (error) {
    // Provide detailed error messages for common failure cases
    const baseMessage = `Could not resolve contract spec for '${contractConfig.contractId}'`;

    if (error instanceof Error) {
      if (error.message.includes("contract not found") || error.message.includes("404")) {
        throw new Error(
          `${baseMessage}: Contract not found on ${network} network. Verify the contract ID and network.`,
        );
      }

      if (error.message.includes("network") || error.message.includes("connection")) {
        throw new Error(
          `${baseMessage}: Network error when connecting to ${rpcUrl}. Check your connection and RPC endpoint.`,
        );
      }

      if (error.message.includes("NoEmbeddedSpecError")) {
        throw new Error(
          `${baseMessage}: Contract has no embedded spec (likely a Stellar Asset Contract). Consider publishing the spec to the registry.`,
        );
      }

      throw new Error(`${baseMessage}: ${error.message}`);
    }

    throw new Error(`${baseMessage}: ${String(error)}`);
  }
}

/**
 * Gets the default RPC URL for a network
 */
function getDefaultRpcUrl(network: "mainnet" | "testnet" | "futurenet"): string {
  switch (network) {
    case "mainnet":
      return "https://soroban-mainnet.stellar.org";
    case "testnet":
      return "https://soroban-testnet.stellar.org";
    case "futurenet":
      return "https://soroban-futurenet.stellar.org";
    default:
      return "https://soroban-testnet.stellar.org";
  }
}

/**
 * Gets the network passphrase for a network
 */
function getNetworkPassphrase(network: "mainnet" | "testnet" | "futurenet"): string {
  switch (network) {
    case "mainnet":
      return Networks.PUBLIC;
    case "testnet":
      return Networks.TESTNET;
    case "futurenet":
      return Networks.FUTURENET;
    default:
      return Networks.TESTNET;
  }
}

/**
 * Sanitizes a contract name to be used as a filename
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^[0-9]+/, "_$&")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}
