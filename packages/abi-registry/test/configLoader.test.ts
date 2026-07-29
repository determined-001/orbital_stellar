import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  configExists,
  getConfigDirectory,
  ConfigLoadError,
} from "../src/configLoader.js";

const VALID_CONTRACT_ID = "C" + "A".repeat(55);

describe("configLoader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `orbital-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadConfig", () => {
    it("should load a valid JSON config", async () => {
      const configPath = join(testDir, "orbital.config.json");
      const config = {
        contracts: [{ contractId: VALID_CONTRACT_ID }],
        outDir: "./generated",
      };
      writeFileSync(configPath, JSON.stringify(config), "utf-8");

      const result = await loadConfig(configPath);
      expect(result.config.contracts).toHaveLength(1);
      expect(result.config.outDir).toBe("./generated");
      expect(result.configPath).toBe(configPath);
      expect(typeof result.configHash).toBe("string");
    });

    it("should handle different JSON config structure", async () => {
      const configPath = join(testDir, "test.config.json");
      const config = {
        contracts: [{ contractId: VALID_CONTRACT_ID }],
        outDir: "./types",
        network: "futurenet",
      };
      writeFileSync(configPath, JSON.stringify(config), "utf-8");

      const result = await loadConfig(configPath);
      expect(result.config.network).toBe("futurenet");
      expect(result.config.outDir).toBe("./types");
    });

    it("should handle malformed config gracefully", async () => {
      const configPath = join(testDir, "bad.config.json");
      writeFileSync(
        configPath,
        '{"contracts":[{"contractId":"invalid"}],"outDir":"./gen"}',
        "utf-8",
      );

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
    });

    it("should throw ConfigLoadError for non-existent file", async () => {
      const nonExistentPath = join(testDir, "nonexistent.config.ts");

      await expect(loadConfig(nonExistentPath)).rejects.toThrow(ConfigLoadError);
      await expect(loadConfig(nonExistentPath)).rejects.toThrow(/not found/);
    });

    it("should throw ConfigLoadError for invalid JSON", async () => {
      const configPath = join(testDir, "orbital.config.json");
      writeFileSync(configPath, "{ invalid json }", "utf-8");

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
      await expect(loadConfig(configPath)).rejects.toThrow(/syntax errors/);
    });

    it("should throw ConfigLoadError for invalid config content", async () => {
      const configPath = join(testDir, "orbital.config.json");
      const invalidConfig = {
        contracts: [], // Invalid: empty array
        outDir: "./generated",
      };
      writeFileSync(configPath, JSON.stringify(invalidConfig), "utf-8");

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
      await expect(loadConfig(configPath)).rejects.toThrow(/validation failed/);
    });

    it("should throw error when no config file found during auto-discovery", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await expect(loadConfig()).rejects.toThrow(ConfigLoadError);
        await expect(loadConfig()).rejects.toThrow(/No orbital configuration file found/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("configExists", () => {
    it("should return true for existing config file", () => {
      const configPath = join(testDir, "orbital.config.ts");
      writeFileSync(configPath, "export default {};", "utf-8");

      expect(configExists(configPath)).toBe(true);
    });

    it("should return false for non-existent config file", () => {
      // Use a completely different directory that doesn't exist
      const nonExistentDir = join(testDir, "subdir-that-doesnt-exist");
      const nonExistentPath = join(nonExistentDir, "nonexistent.config.ts");
      expect(configExists(nonExistentPath)).toBe(false);
    });

    it("should check common config file names when no path provided", () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        expect(configExists()).toBe(false);

        // Create a config file
        writeFileSync(join(testDir, "orbital.config.ts"), "export default {};", "utf-8");
        expect(configExists()).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("getConfigDirectory", () => {
    it("should return directory of specified config file", () => {
      const configPath = join(testDir, "subdir", "orbital.config.ts");
      mkdirSync(join(testDir, "subdir"), { recursive: true });
      writeFileSync(configPath, "export default {};", "utf-8");

      const configDir = getConfigDirectory(configPath);
      expect(configDir).toBe(join(testDir, "subdir"));
    });

    it("should return current directory when no path specified", () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        writeFileSync(join(testDir, "orbital.config.ts"), "export default {};", "utf-8");

        const configDir = getConfigDirectory();
        expect(configDir).toBe(testDir);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("ConfigLoadError", () => {
    it("should create error with message and optional path", () => {
      const error = new ConfigLoadError("test message", "/test/path");
      expect(error.message).toBe("test message");
      expect(error.path).toBe("/test/path");
      expect(error.name).toBe("ConfigLoadError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with message only", () => {
      const error = new ConfigLoadError("test message");
      expect(error.message).toBe("test message");
      expect(error.path).toBeUndefined();
    });
  });
});
