import { describe, test, expect } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateForContract, writeLockFile } from "../src/watch.js";
import type { OrbitalCodegenConfig } from "../src/config.js";

describe("watch mode", () => {
  let tmpDir: string;

  function makeConfig(overrides: Partial<OrbitalCodegenConfig> = {}): OrbitalCodegenConfig {
    return {
      contracts: [{ contractId: "C123", name: "test-contract" }],
      outDir: tmpDir,
      ...overrides,
    };
  }

  function writeSpec(name: string, data: Record<string, unknown>) {
    const path = resolve(tmpDir, `${name}.spec.json`);
    writeFileSync(path, JSON.stringify(data), "utf-8");
    return path;
  }

  test("generateForContract returns hash on success", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    writeSpec("test-contract", {
      name: "TestContract",
      functions: [],
      events: [{ name: "Ping", data: [{ name: "count", type: "u32" }] }],
      types: {},
    });

    const config = makeConfig();
    const hash = await generateForContract("C123", config, "test-contract");
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash!.length).toBe(64);

    const outPath = resolve(tmpDir, "test-contract.d.ts");
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("Ping");
  });

  test("generateForContract returns null for unresolvable contract", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    const config = makeConfig();
    const hash = await generateForContract("C999", config, "nonexistent");
    expect(hash).toBeNull();
  });

  test("writeLockFile writes atomically", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    const lock = {
      "test-contract": {
        specHash: "a".repeat(64),
        verifiedAt: "2026-07-28T12:00:00Z",
      },
    };

    writeLockFile(tmpDir, lock);

    const lockPath = resolve(tmpDir, "orbital.lock.json");
    expect(existsSync(lockPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(parsed).toEqual(lock);
  });
});
