import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { generateContractTypes } from "./generate.js";
import type { ContractSpec } from "./spec.js";
import type { OrbitalCodegenConfig, OrbitalLockFile, CodegenContract } from "./config.js";

export type CodegenWatchOptions = {
  pollIntervalMs?: number;
  debounceMs?: number;
  cwd?: string;
};

async function resolveContractSpec(
  contractId: string,
  config: OrbitalCodegenConfig,
): Promise<{ spec: ContractSpec; hash: string } | null> {
  const specPath = resolve(config.outDir, `${contractId}.spec.json`);
  if (!existsSync(specPath)) {
    const contract = config.contracts.find((c: CodegenContract) => c.contractId === contractId);
    if (contract?.name) {
      const namedPath = resolve(config.outDir, `${contract.name}.spec.json`);
      if (existsSync(namedPath)) {
        const content = readFileSync(namedPath, "utf-8");
        const hash = createHash("sha256").update(content).digest("hex");
        return { spec: JSON.parse(content) as ContractSpec, hash };
      }
    }
    return null;
  }

  const content = readFileSync(specPath, "utf-8");
  const hash = createHash("sha256").update(content).digest("hex");
  return { spec: JSON.parse(content) as ContractSpec, hash };
}

export async function generateForContract(
  contractId: string,
  config: OrbitalCodegenConfig,
  contractName?: string,
): Promise<string | null> {
  const resolved = await resolveContractSpec(contractId, config);
  if (!resolved) return null;

  const { spec, hash } = resolved;
  const name = contractName ?? contractId;
  const outPath = resolve(config.outDir, `${name}.d.ts`);

  const generated = generateContractTypes(spec);

  const tmpPath = `${outPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, generated, "utf-8");
  renameSync(tmpPath, outPath);

  return hash;
}

export function writeLockFile(cwd: string, lock: OrbitalLockFile): void {
  const lockPath = resolve(cwd, "orbital.lock.json");
  const tmpPath = `${lockPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(lock, null, 2), "utf-8");
  renameSync(tmpPath, lockPath);
}

export async function watchCodegen(
  config: OrbitalCodegenConfig,
  options: CodegenWatchOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const debounceMs = options.debounceMs ?? 2_000;
  const cwd = options.cwd ?? process.cwd();

  let lockFile: OrbitalLockFile | null = null;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  let shouldRun = true;
  let needsRegeneration = false;

  const onSigint = () => {
    shouldRun = false;
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
    console.log("\n[orbital codegen --watch] SIGINT received, exiting cleanly.");
    process.exit(0);
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  console.log(
    `[orbital codegen --watch] Watching ${config.contracts.length} contract(s) (poll every ${pollIntervalMs}ms)...`,
  );
  if (debounceMs > 0) {
    console.log(`[orbital codegen --watch] Burst debounce window: ${debounceMs}ms`);
  }

  try {
    const lockPath = resolve(cwd, "orbital.lock.json");
    if (existsSync(lockPath)) {
      lockFile = JSON.parse(readFileSync(lockPath, "utf-8")) as OrbitalLockFile;
    }
  } catch {
    lockFile = null;
  }

  const regenerate = async () => {
    needsRegeneration = false;
    const updatedLock: OrbitalLockFile = { ...(lockFile ?? {}) };
    let anyChanged = false;

    for (const contract of config.contracts) {
      // eslint-disable-next-line no-await-in-loop
      const hash = await generateForContract(contract.contractId, config, contract.name);

      if (hash === null) {
        console.log(`  [${contract.name ?? contract.contractId}] SKIP - spec not resolvable`);
        continue;
      }

      const name = contract.name ?? contract.contractId;
      const prevHash = lockFile?.[name]?.specHash;

      if (prevHash === hash) {
        console.log(`  [${name}] OK - hash unchanged (${hash.slice(0, 12)}...)`);
      } else {
        console.log(
          `  [${name}] REGENERATED - ${prevHash ? `old: ${prevHash.slice(0, 12)}... new: ${hash.slice(0, 12)}...` : `hash: ${hash.slice(0, 12)}...`}`,
        );
        anyChanged = true;
      }

      updatedLock[name] = {
        specHash: hash,
        verifiedAt: new Date().toISOString(),
      };
    }

    if (anyChanged || !lockFile) {
      writeLockFile(cwd, updatedLock);
      lockFile = updatedLock;
    }
  };

  await regenerate();

  while (shouldRun) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    if (!shouldRun) break;

    if (needsRegeneration) continue;
    needsRegeneration = true;

    if (debounceMs > 0) {
      if (pendingTimeout) clearTimeout(pendingTimeout);
      pendingTimeout = setTimeout(async () => {
        pendingTimeout = null;
        await regenerate();
      }, debounceMs);
    } else {
      await regenerate();
    }
  }

  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigint);
}
