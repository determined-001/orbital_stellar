/**
 * Configuration system for orbital.config.ts contract manifests
 */

export interface ContractConfig {
  /** Contract ID (C...) */
  contractId: string;
  /** Optional custom name for the generated types (defaults to contractId) */
  name?: string;
}

export interface OrbitalConfig {
  /** Array of contracts to generate types for */
  contracts: ContractConfig[];
  /** Network to resolve contracts on */
  network?: "mainnet" | "testnet" | "futurenet";
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** On-chain ABI registry contract to resolve against first */
  registryContractId?: string;
  /** Publisher address to resolve on-chain specs under */
  registryPublisher?: string;
  /** Output directory for generated files */
  outDir: string;
}

// Legacy aliases for backward compatibility with existing code
export type CodegenContract = ContractConfig;
export type OrbitalCodegenConfig = OrbitalConfig;

/**
 * Defines an orbital configuration with proper typing
 */
export function defineConfig(config: OrbitalConfig): OrbitalConfig {
  return config;
}

export interface LockFileContract {
  /** Contract ID */
  contractId: string;
  /** Contract name used in generation */
  name: string;
  /** Resolved spec hash for drift detection */
  specHash: string;
  /** Timestamp when this was last resolved */
  resolvedAt: string;
  /** Source of the spec (registry|wasm) */
  source: "registry" | "wasm";
}

export interface LockFile {
  /** Lock file format version */
  version: "1.0.0";
  /** Configuration hash to detect config changes */
  configHash: string;
  /** Locked contracts with their resolved specs */
  contracts: LockFileContract[];
  /** Timestamp when lock file was generated */
  generatedAt: string;
}

// Legacy lock file types for backward compatibility
export interface OrbitalLockEntry {
  /** sha256 hex of the resolved ContractSpec JSON */
  specHash: string;
  /** When this hash was last verified (ISO 8601) */
  verifiedAt: string;
}

export type OrbitalLockFile = Record<string, OrbitalLockEntry>;

/**
 * Configuration validation errors
 */
export class ConfigValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(`Invalid config field '${field}': ${message}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Validates an orbital configuration
 */
export function validateConfig(config: unknown): asserts config is OrbitalConfig {
  if (!config || typeof config !== "object") {
    throw new ConfigValidationError("root", "Configuration must be an object");
  }

  const cfg = config as Record<string, unknown>;

  // Validate contracts array
  if (!cfg.contracts) {
    throw new ConfigValidationError("contracts", "Required field 'contracts' is missing");
  }

  if (!Array.isArray(cfg.contracts)) {
    throw new ConfigValidationError("contracts", "Must be an array");
  }

  if (cfg.contracts.length === 0) {
    throw new ConfigValidationError("contracts", "Must contain at least one contract");
  }

  // Validate each contract
  cfg.contracts.forEach((contract, index) => {
    if (!contract || typeof contract !== "object") {
      throw new ConfigValidationError(
        `contracts[${index}]`,
        "Contract configuration must be an object",
      );
    }

    const contractCfg = contract as Record<string, unknown>;

    if (!contractCfg.contractId) {
      throw new ConfigValidationError(
        `contracts[${index}].contractId`,
        "Required field 'contractId' is missing",
      );
    }

    if (typeof contractCfg.contractId !== "string") {
      throw new ConfigValidationError(`contracts[${index}].contractId`, "Must be a string");
    }

    if (!contractCfg.contractId.match(/^C[A-Z0-9]{55}$/)) {
      throw new ConfigValidationError(
        `contracts[${index}].contractId`,
        "Must be a valid Stellar contract ID (C...)",
      );
    }

    if (contractCfg.name !== undefined && typeof contractCfg.name !== "string") {
      throw new ConfigValidationError(`contracts[${index}].name`, "Must be a string if provided");
    }
  });

  // Validate outDir
  if (!cfg.outDir) {
    throw new ConfigValidationError("outDir", "Required field 'outDir' is missing");
  }

  if (typeof cfg.outDir !== "string") {
    throw new ConfigValidationError("outDir", "Must be a string");
  }

  // Validate optional network
  if (cfg.network !== undefined) {
    if (typeof cfg.network !== "string") {
      throw new ConfigValidationError("network", "Must be a string");
    }

    if (!["mainnet", "testnet", "futurenet"].includes(cfg.network)) {
      throw new ConfigValidationError("network", "Must be one of: mainnet, testnet, futurenet");
    }
  }

  // Validate optional rpcUrl
  if (cfg.rpcUrl !== undefined && typeof cfg.rpcUrl !== "string") {
    throw new ConfigValidationError("rpcUrl", "Must be a string");
  }

  // Validate optional registry fields
  if (cfg.registryContractId !== undefined) {
    if (typeof cfg.registryContractId !== "string") {
      throw new ConfigValidationError("registryContractId", "Must be a string");
    }
    if (cfg.registryContractId && !cfg.registryContractId.match(/^C[A-Z0-9]{55}$/)) {
      throw new ConfigValidationError(
        "registryContractId",
        "Must be a valid Stellar contract ID (C...)",
      );
    }
  }

  if (cfg.registryPublisher !== undefined) {
    if (typeof cfg.registryPublisher !== "string") {
      throw new ConfigValidationError("registryPublisher", "Must be a string");
    }
    if (cfg.registryPublisher && !cfg.registryPublisher.match(/^G[A-Z0-9]{55}$/)) {
      throw new ConfigValidationError(
        "registryPublisher",
        "Must be a valid Stellar account ID (G...)",
      );
    }
  }

  // Validate duplicate contract IDs
  const contractIds = new Set<string>();
  const contractNames = new Set<string>();

  cfg.contracts.forEach((contract, index) => {
    const contractCfg = contract as Record<string, unknown>;

    if (contractIds.has(contractCfg.contractId as string)) {
      throw new ConfigValidationError(
        `contracts[${index}].contractId`,
        `Duplicate contract ID: ${contractCfg.contractId}`,
      );
    }
    contractIds.add(contractCfg.contractId as string);

    const name = contractCfg.name || contractCfg.contractId;
    if (contractNames.has(name as string)) {
      throw new ConfigValidationError(
        `contracts[${index}].name`,
        `Duplicate contract name: ${name} (names must be unique for file generation)`,
      );
    }
    contractNames.add(name as string);
  });

  // Validate outDir is not empty and doesn't contain dangerous paths
  const outDir = cfg.outDir as string;
  if (!outDir.trim()) {
    throw new ConfigValidationError("outDir", "Cannot be empty or whitespace-only");
  }

  if (outDir.includes("..")) {
    throw new ConfigValidationError("outDir", "Cannot contain parent directory references (..)");
  }

  if (outDir.startsWith("/") || outDir.match(/^[A-Z]:/)) {
    throw new ConfigValidationError("outDir", "Should be a relative path, not absolute");
  }
}

/**
 * Legacy function for backward compatibility - loads codegen config
 * This is a simplified version that wraps the new loadConfig function
 */
export function loadCodegenConfig(cwd: string): {
  config: OrbitalCodegenConfig | null;
  lockFile: OrbitalLockFile | null;
  errors: string[];
} {
  // This is a placeholder implementation for compatibility
  // The real implementation should use the new loadConfig system
  return {
    config: null,
    lockFile: null,
    errors: ["Use the new loadConfig function instead"],
  };
}

/**
 * Legacy function for backward compatibility - loads lock file
 */
export function loadLockFile(cwd: string): OrbitalLockFile | null {
  // This is a placeholder implementation for compatibility
  // The real implementation should use the new lock file system
  return null;
}
