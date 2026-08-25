import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");
const cliPath = join(packageRoot, "bin", "orbital-codegen");
const tempRoot = join(packageRoot, ".tmp-vitest");
const tempDirs: string[] = [];

mkdirSync(tempRoot, { recursive: true });

type Scenario = {
  loadConfigResult?: {
    config: { contracts: Array<{ contractId: string }>; outDir: string };
    configHash: string;
    configPath: string;
  };
  driftResult?: { hasChanges: boolean; report: string };
  generationResult?: {
    contractsProcessed: number;
    contracts: Array<{ name: string; outputPath: string }>;
    lockFileUpdated: boolean;
  };
};

function createMockModules(tempDir: string, scenario: Scenario) {
  const distDir = join(tempDir, "dist");
  const callsPath = join(tempDir, "calls.json");

  mkdirSync(distDir, { recursive: true });

  writeFileSync(
    join(distDir, "generate.js"),
    `
export function generateContractTypes(spec) {
  return JSON.stringify(spec, null, 2);
}
`,
    "utf8",
  );

  writeFileSync(
    join(distDir, "configLoader.js"),
    `
import { writeFileSync } from "node:fs";

const callsPath = ${JSON.stringify(callsPath)};
const loadConfigResult = ${JSON.stringify(scenario.loadConfigResult ?? null)};
const calls = [];

function recordCall(name, args) {
  calls.push({ name, args });
  writeFileSync(callsPath, JSON.stringify(calls, null, 2), "utf8");
}

export class ConfigLoadError extends Error {}

export async function loadConfig(configPath) {
  recordCall("loadConfig", [configPath]);
  return loadConfigResult;
}
`,
    "utf8",
  );

  writeFileSync(
    join(distDir, "batchGeneration.js"),
    `
import { readFileSync, writeFileSync } from "node:fs";

const callsPath = ${JSON.stringify(callsPath)};
const driftResult = ${JSON.stringify(scenario.driftResult ?? null)};
const generationResult = ${JSON.stringify(scenario.generationResult ?? null)};

function recordCall(name, args) {
  let calls = [];
  try {
    calls = JSON.parse(readFileSync(callsPath, "utf8"));
  } catch {}
  calls.push({ name, args });
  writeFileSync(callsPath, JSON.stringify(calls, null, 2), "utf8");
}

export class BatchGenerationError extends Error {}

export async function checkForDrift(config, configHash, configPath) {
  recordCall("checkForDrift", [config, configHash, configPath]);
  return driftResult;
}

export async function generateBatchTypes(config, configHash, configPath) {
  recordCall("generateBatchTypes", [config, configHash, configPath]);
  return generationResult;
}
`,
    "utf8",
  );

  return callsPath;
}

function runCli(args: string[], scenario: Scenario) {
  const tempDir = mkdtempSync(join(tempRoot, "orbital-codegen-cli-"));
  tempDirs.push(tempDir);

  mkdirSync(join(tempDir, "bin"), { recursive: true });
  copyFileSync(cliPath, join(tempDir, "bin", "orbital-codegen.mjs"));
  writeFileSync(
    join(tempDir, "package.json"),
    JSON.stringify({ version: "0.1.0" }, null, 2),
    "utf8",
  );

  const callsPath = createMockModules(tempDir, scenario);
  const result = spawnSync(
    process.execPath,
    [join(tempDir, "bin", "orbital-codegen.mjs"), ...args],
    {
      cwd: tempDir,
      encoding: "utf8",
    },
  );

  const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : [];
  return { result, calls };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("orbital-codegen CLI", () => {
  it("prints the package version without trying to load config", () => {
    const { result, calls } = runCli(["--version"], {});

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
    expect(calls).toEqual([]);
  });

  it("runs drift checks through the shipped orbital-codegen bin", () => {
    const config = {
      contracts: [{ contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
      outDir: "./generated",
    };

    const { result, calls } = runCli(["--check"], {
      loadConfigResult: {
        config,
        configHash: "config-hash",
        configPath: "/tmp/orbital.config.ts",
      },
      driftResult: {
        hasChanges: true,
        report: "✗ Changes detected in generated files",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ Changes detected in generated files");
    expect(calls).toEqual([
      { name: "loadConfig", args: [null] },
      {
        name: "checkForDrift",
        args: [config, "config-hash", "/tmp/orbital.config.ts"],
      },
    ]);
  });

  it("runs batch generation through the shipped orbital-codegen bin", () => {
    const config = {
      contracts: [{ contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
      outDir: "./generated",
    };

    const { result, calls } = runCli([], {
      loadConfigResult: {
        config,
        configHash: "config-hash",
        configPath: "/tmp/orbital.config.ts",
      },
      generationResult: {
        contractsProcessed: 2,
        contracts: [
          { name: "alpha", outputPath: "./generated/alpha.ts" },
          { name: "beta", outputPath: "./generated/beta.ts" },
        ],
        lockFileUpdated: true,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[orbital codegen] Generated types for 2 contracts:");
    expect(result.stdout).toContain("  ✓ alpha → ./generated/alpha.ts");
    expect(result.stdout).toContain("  ✓ beta → ./generated/beta.ts");
    expect(result.stdout).toContain("[orbital codegen] Updated orbital.lock.json");
    expect(calls).toEqual([
      { name: "loadConfig", args: [null] },
      {
        name: "generateBatchTypes",
        args: [config, "config-hash", "/tmp/orbital.config.ts"],
      },
    ]);
  });
});
