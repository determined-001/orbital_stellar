import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadLockFile,
  saveLockFile,
  createLockFile,
  generateSpecHash,
  detectDrift,
  getLockFilePath,
  formatDriftReport,
  LockFileError,
} from "../src/lockFile.js";
import type { LockFile, ContractConfig } from "../src/config.js";
import type { ContractSpec } from "../src/spec.js";

const VALID_CONTRACT_ID_1 = "C" + "A".repeat(55);
const VALID_CONTRACT_ID_2 = "C" + "B".repeat(55);

describe("lockFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `orbital-lockfile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadLockFile", () => {
    it("should load valid lock file", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "test-hash",
        contracts: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            specHash: "spec-hash-123",
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const lockPath = join(testDir, "orbital.lock.json");
      writeFileSync(lockPath, JSON.stringify(lockFile), "utf-8");

      const loaded = loadLockFile(lockPath);
      expect(loaded).toEqual(lockFile);
    });

    it("should return null for non-existent file", () => {
      const lockPath = join(testDir, "nonexistent.lock.json");
      const loaded = loadLockFile(lockPath);
      expect(loaded).toBeNull();
    });

    it("should throw LockFileError for invalid JSON", () => {
      const lockPath = join(testDir, "invalid.lock.json");
      writeFileSync(lockPath, "{ invalid json }", "utf-8");

      expect(() => loadLockFile(lockPath)).toThrow(LockFileError);
      expect(() => loadLockFile(lockPath)).toThrow(/Failed to read lock file/);
    });

    it("should throw LockFileError for invalid format", () => {
      const lockPath = join(testDir, "invalid-format.lock.json");
      const invalidLockFile = { invalid: "format" };
      writeFileSync(lockPath, JSON.stringify(invalidLockFile), "utf-8");

      expect(() => loadLockFile(lockPath)).toThrow(LockFileError);
      expect(() => loadLockFile(lockPath)).toThrow(/Invalid lock file format/);
    });

    it("should upgrade legacy object-shaped lock files", () => {
      const legacyLockFile = {
        MyContract: {
          specHash: "legacy-hash-123",
          verifiedAt: "2023-01-01T00:00:00.000Z",
        },
      };

      const lockPath = join(testDir, "orbital.lock.json");
      writeFileSync(lockPath, JSON.stringify(legacyLockFile), "utf-8");

      const loaded = loadLockFile(lockPath);
      expect(loaded).toEqual({
        version: "1.0.0",
        configHash: "legacy",
        contracts: [
          {
            contractId: "MyContract",
            name: "MyContract",
            specHash: "legacy-hash-123",
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      });
    });
  });

  describe("saveLockFile", () => {
    it("should save lock file", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "test-hash",
        contracts: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            specHash: "spec-hash-123",
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const lockPath = join(testDir, "orbital.lock.json");
      saveLockFile(lockPath, lockFile);

      expect(existsSync(lockPath)).toBe(true);
      const loaded = loadLockFile(lockPath);
      expect(loaded).toEqual(lockFile);
    });

    it("should throw LockFileError on write failure", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "test-hash",
        contracts: [],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      // Try to write to invalid path
      const invalidPath = join(testDir, "nonexistent", "orbital.lock.json");

      expect(() => saveLockFile(invalidPath, lockFile)).toThrow(LockFileError);
      expect(() => saveLockFile(invalidPath, lockFile)).toThrow(/Failed to write lock file/);
    });
  });

  describe("createLockFile", () => {
    it("should create lock file from contracts", () => {
      const configHash = "config-hash-123";
      const spec: ContractSpec = {
        name: "TestContract",
        contractId: VALID_CONTRACT_ID_1,
        functions: [],
        events: [],
        types: {},
        xdrEntries: [],
      };

      const contracts = [
        {
          config: { contractId: VALID_CONTRACT_ID_1, name: "TestContract" },
          spec,
          source: "registry" as const,
        },
      ];

      const lockFile = createLockFile(configHash, contracts);

      expect(lockFile.version).toBe("1.0.0");
      expect(lockFile.configHash).toBe(configHash);
      expect(lockFile.contracts).toHaveLength(1);
      expect(lockFile.contracts[0].contractId).toBe(VALID_CONTRACT_ID_1);
      expect(lockFile.contracts[0].name).toBe("TestContract");
      expect(lockFile.contracts[0].source).toBe("registry");
      expect(typeof lockFile.contracts[0].specHash).toBe("string");
      expect(typeof lockFile.contracts[0].resolvedAt).toBe("string");
      expect(typeof lockFile.generatedAt).toBe("string");
    });

    it("should use contractId as name when name not provided", () => {
      const spec: ContractSpec = {
        name: "TestContract",
        contractId: VALID_CONTRACT_ID_1,
        functions: [],
        events: [],
        types: {},
        xdrEntries: [],
      };

      const contracts = [
        {
          config: { contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
          spec,
          source: "wasm" as const,
        },
      ];

      const lockFile = createLockFile("test-hash", contracts);
      expect(lockFile.contracts[0].name).toBe(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
    });
  });

  describe("generateSpecHash", () => {
    it("should generate consistent hash for same spec", () => {
      const spec: ContractSpec = {
        name: "TestContract",
        contractId: VALID_CONTRACT_ID_1,
        functions: [],
        events: [],
        types: {},
        xdrEntries: [],
      };

      const hash1 = generateSpecHash(spec);
      const hash2 = generateSpecHash(spec);

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBe(64); // SHA-256 hex
    });

    it("should generate different hash for different specs", () => {
      const spec1: ContractSpec = {
        name: "TestContract1",
        contractId: VALID_CONTRACT_ID_1,
        functions: [],
        events: [],
        types: {},
        xdrEntries: [],
      };

      const spec2: ContractSpec = {
        name: "TestContract2",
        contractId: VALID_CONTRACT_ID_2,
        functions: [],
        events: [],
        types: {},
        xdrEntries: [],
      };

      const hash1 = generateSpecHash(spec1);
      const hash2 = generateSpecHash(spec2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("detectDrift", () => {
    const baseSpec: ContractSpec = {
      name: "TestContract",
      contractId: VALID_CONTRACT_ID_1,
      functions: [],
      events: [],
      types: {},
      xdrEntries: [],
    };

    it("should detect no changes when everything is same", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "same-hash",
        contracts: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            specHash: generateSpecHash(baseSpec),
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const contracts = [
        {
          config: { contractId: VALID_CONTRACT_ID_1, name: "TestContract" },
          spec: baseSpec,
          source: "registry" as const,
        },
      ];

      const drift = detectDrift(lockFile, "same-hash", contracts);

      expect(drift.hasChanges).toBe(false);
      expect(drift.configChanged).toBe(false);
      expect(drift.contractChanges).toHaveLength(0);
    });

    it("should detect config changes", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "old-hash",
        contracts: [],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const drift = detectDrift(lockFile, "new-hash", []);

      expect(drift.hasChanges).toBe(true);
      expect(drift.configChanged).toBe(true);
    });

    it("should detect added contracts", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "same-hash",
        contracts: [],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const contracts = [
        {
          config: { contractId: VALID_CONTRACT_ID_1, name: "TestContract" },
          spec: baseSpec,
          source: "registry" as const,
        },
      ];

      const drift = detectDrift(lockFile, "same-hash", contracts);

      expect(drift.hasChanges).toBe(true);
      expect(drift.configChanged).toBe(false);
      expect(drift.contractChanges).toHaveLength(1);
      expect(drift.contractChanges[0].change).toBe("added");
      expect(drift.contractChanges[0].contractId).toBe(VALID_CONTRACT_ID_1);
    });

    it("should detect removed contracts", () => {
      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "same-hash",
        contracts: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            specHash: "old-hash",
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const drift = detectDrift(lockFile, "same-hash", []);

      expect(drift.hasChanges).toBe(true);
      expect(drift.contractChanges).toHaveLength(1);
      expect(drift.contractChanges[0].change).toBe("removed");
    });

    it("should detect modified contracts", () => {
      const modifiedSpec: ContractSpec = {
        ...baseSpec,
        name: "ModifiedContract",
      };

      const lockFile: LockFile = {
        version: "1.0.0",
        configHash: "same-hash",
        contracts: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            specHash: generateSpecHash(baseSpec),
            resolvedAt: "2023-01-01T00:00:00.000Z",
            source: "registry",
          },
        ],
        generatedAt: "2023-01-01T00:00:00.000Z",
      };

      const contracts = [
        {
          config: { contractId: VALID_CONTRACT_ID_1, name: "TestContract" },
          spec: modifiedSpec,
          source: "registry" as const,
        },
      ];

      const drift = detectDrift(lockFile, "same-hash", contracts);

      expect(drift.hasChanges).toBe(true);
      expect(drift.contractChanges).toHaveLength(1);
      expect(drift.contractChanges[0].change).toBe("modified");
      expect(drift.contractChanges[0].oldHash).toBe(generateSpecHash(baseSpec));
      expect(drift.contractChanges[0].newHash).toBe(generateSpecHash(modifiedSpec));
    });

    it("matches legacy migrated lock entries by configured contract name", () => {
      const lockPath = join(testDir, "orbital.lock.json");
      const legacyLockFile = {
        FriendlyName: {
          specHash: generateSpecHash(baseSpec),
          verifiedAt: "2023-01-01T00:00:00.000Z",
        },
      };
      writeFileSync(lockPath, JSON.stringify(legacyLockFile), "utf-8");

      const migrated = loadLockFile(lockPath);
      expect(migrated).not.toBeNull();

      const drift = detectDrift(migrated!, "legacy", [
        {
          config: { contractId: VALID_CONTRACT_ID_1, name: "FriendlyName" },
          spec: baseSpec,
          source: "registry" as const,
        },
      ]);

      expect(drift.hasChanges).toBe(false);
      expect(drift.configChanged).toBe(false);
      expect(drift.contractChanges).toHaveLength(0);
    });
  });

  describe("getLockFilePath", () => {
    it("should return correct lock file path", () => {
      const configDir = "/test/config/dir";
      const lockPath = getLockFilePath(configDir);
      expect(lockPath).toBe(resolve(configDir, "orbital.lock.json"));
    });
  });

  describe("formatDriftReport", () => {
    it("should format no changes report", () => {
      const drift = {
        hasChanges: false,
        configChanged: false,
        contractChanges: [],
      };

      const report = formatDriftReport(drift);
      expect(report).toContain("✓ No changes detected");
    });

    it("should format config changes report", () => {
      const drift = {
        hasChanges: true,
        configChanged: true,
        contractChanges: [],
      };

      const report = formatDriftReport(drift);
      expect(report).toContain("✗ Changes detected");
      expect(report).toContain("• Configuration changed");
    });

    it("should format contract changes report", () => {
      const drift = {
        hasChanges: true,
        configChanged: false,
        contractChanges: [
          {
            contractId: VALID_CONTRACT_ID_1,
            name: "TestContract",
            change: "added" as const,
            newHash: "new-hash-123",
          },
          {
            contractId: VALID_CONTRACT_ID_2,
            name: "TestContract2",
            change: "removed" as const,
            oldHash: "old-hash-456",
          },
          {
            contractId: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            name: "TestContract3",
            change: "modified" as const,
            oldHash: "old-hash-789",
            newHash: "new-hash-789",
          },
        ],
      };

      const report = formatDriftReport(drift);
      expect(report).toContain("✗ Changes detected");
      expect(report).toContain("3 contract changes");
      expect(report).toContain("+ TestContract");
      expect(report).toContain("- TestContract2");
      expect(report).toContain("~ TestContract3");
      expect(report).toContain("Old hash: old-hash-789");
      expect(report).toContain("New hash: new-hash-789");
    });
  });

  describe("LockFileError", () => {
    it("should create error with message and optional path", () => {
      const error = new LockFileError("test message", "/test/path");
      expect(error.message).toBe("test message");
      expect(error.path).toBe("/test/path");
      expect(error.name).toBe("LockFileError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with message only", () => {
      const error = new LockFileError("test message");
      expect(error.message).toBe("test message");
      expect(error.path).toBeUndefined();
    });
  });
});
