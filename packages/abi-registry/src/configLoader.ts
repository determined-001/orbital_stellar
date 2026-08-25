import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { OrbitalConfig } from "./config.js";
import { validateConfig, ConfigValidationError } from "./config.js";

/**
 * Error thrown when config file is not found or has issues
 */
export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public path?: string,
  ) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

/**
 * Loads and validates an orbital.config.ts file
 */
export async function loadConfig(configPath?: string): Promise<{
  config: OrbitalConfig;
  configPath: string;
  configHash: string;
}> {
  // Resolve config file path
  const resolvedPath = resolveConfigPath(configPath);

  if (!existsSync(resolvedPath)) {
    throw new ConfigLoadError(`Configuration file not found: ${resolvedPath}`, resolvedPath);
  }

  let config: unknown;

  try {
    if (resolvedPath.endsWith(".ts")) {
      // For TypeScript configs, we need to use dynamic import
      // Convert to file URL for proper module loading
      const fileUrl = pathToFileURL(resolvedPath).href;
      // The specifier is a user's absolute path, known only at runtime, so a
      // bundler must not try to follow it.
      //
      // NOTE: this alone does not silence the "whole project was traced"
      // warning in apps/web. The remaining cause is structural - this CLI-only
      // module is reachable from the package's main entry, so anything that
      // imports abi-registry (apps/web, via pulse-core) drags its filesystem
      // operations into the serverless bundle. The real fix is to move config
      // loading behind its own subpath export and drop it from index.ts, which
      // is a public-API change and deliberately not made here.
      const module = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ fileUrl);
      config = module.default || module;
    } else {
      // For JSON configs
      const content = readFileSync(resolvedPath, "utf-8");
      config = JSON.parse(content);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigLoadError(
        `Configuration file has syntax errors: ${error.message}`,
        resolvedPath,
      );
    }
    throw new ConfigLoadError(
      `Failed to load configuration file: ${error instanceof Error ? error.message : String(error)}`,
      resolvedPath,
    );
  }

  // Validate the loaded config
  try {
    validateConfig(config);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new ConfigLoadError(`Configuration validation failed: ${error.message}`, resolvedPath);
    }
    throw error;
  }

  // Generate config hash for lock file
  const configHash = generateConfigHash(config);

  return {
    config: config as OrbitalConfig,
    configPath: resolvedPath,
    configHash,
  };
}

/**
 * Resolves the config file path, checking multiple locations
 */
function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    return resolve(configPath);
  }

  // Check for common config file names in current directory
  const possiblePaths = [
    "orbital.config.ts",
    "orbital.config.js",
    "orbital.config.mjs",
    "orbital.config.json",
  ];

  for (const path of possiblePaths) {
    // Resolved against the CLI's working directory, which a bundler cannot
    // know - see the note on the dynamic import above.
    const fullPath = resolve(/* turbopackIgnore: true */ path);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new ConfigLoadError(
    `No orbital configuration file found. Looked for: ${possiblePaths.join(", ")}`,
  );
}

/**
 * Generates a hash of the config for change detection
 */
function generateConfigHash(config: OrbitalConfig): string {
  // Create a normalized config for hashing (exclude non-essential fields)
  const normalizedConfig = {
    contracts: config.contracts.map((contract) => ({
      contractId: contract.contractId,
      name: contract.name || contract.contractId,
    })),
    network: config.network || "testnet",
    rpcUrl: config.rpcUrl,
    registryContractId: config.registryContractId,
    registryPublisher: config.registryPublisher,
    outDir: config.outDir,
  };

  const configString = JSON.stringify(normalizedConfig, Object.keys(normalizedConfig).sort());
  return createHash("sha256").update(configString).digest("hex");
}

/**
 * Checks if a config file exists at the given path or in common locations
 */
export function configExists(configPath?: string): boolean {
  try {
    if (configPath) {
      // For explicit paths, check if the file exists directly
      return existsSync(resolve(configPath));
    }
    // For no path provided, use the resolver which checks common locations
    resolveConfigPath(configPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the directory containing the config file
 */
export function getConfigDirectory(configPath?: string): string {
  const resolvedPath = resolveConfigPath(configPath);
  return dirname(resolvedPath);
}
