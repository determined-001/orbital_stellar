import { describe, it, expect } from "vitest";
import {
  defineConfig,
  validateConfig,
  ConfigValidationError,
  loadCodegenConfig,
  loadLockFile,
} from "../src/config.js";
import type { OrbitalConfig, ContractConfig } from "../src/config.js";

// Valid Stellar contract IDs (56 characters, C + 55 base32 chars)
const VALID_CONTRACT_ID_1 = "C" + "A".repeat(55);
const VALID_CONTRACT_ID_2 = "C" + "B".repeat(55);
const VALID_CONTRACT_ID_3 = "C" + "C".repeat(55);
const VALID_ACCOUNT_ID = "G" + "A".repeat(55);

describe("defineConfig", () => {
  it("should return the same config object that was passed in", () => {
    const config: OrbitalConfig = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
    };

    const result = defineConfig(config);
    expect(result).toBe(config);
    expect(result).toEqual(config);
  });

  it("should work with full configuration options", () => {
    const config: OrbitalConfig = {
      contracts: [
        {
          contractId: VALID_CONTRACT_ID_1,
          name: "MyContract",
        },
        {
          contractId: VALID_CONTRACT_ID_2,
        },
      ],
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      registryContractId: VALID_CONTRACT_ID_3,
      registryPublisher: VALID_ACCOUNT_ID,
      outDir: "./src/generated",
    };

    const result = defineConfig(config);
    expect(result).toEqual(config);
    expect(result.contracts).toHaveLength(2);
    expect(result.contracts[0].name).toBe("MyContract");
    expect(result.contracts[1].name).toBeUndefined();
  });
});

describe("validateConfig", () => {
  it("should validate a correct config", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it("should throw error for non-object config", () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig("invalid")).toThrow(ConfigValidationError);
    expect(() => validateConfig(123)).toThrow(ConfigValidationError);
  });

  it("should throw error for missing contracts", () => {
    const config = { outDir: "./generated" };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/contracts.*missing/);
  });

  it("should throw error for non-array contracts", () => {
    const config = { contracts: "invalid", outDir: "./generated" };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Must be an array/);
  });

  it("should throw error for empty contracts array", () => {
    const config = { contracts: [], outDir: "./generated" };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/at least one contract/);
  });

  it("should validate contract objects", () => {
    const config = {
      contracts: [null],
      outDir: "./generated",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Contract configuration must be an object/);
  });

  it("should validate contractId field", () => {
    const config = {
      contracts: [{}],
      outDir: "./generated",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/contractId.*missing/);

    const config2 = {
      contracts: [{ contractId: 123 }],
      outDir: "./generated",
    };
    expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config2)).toThrow(/Must be a string/);

    const config3 = {
      contracts: [{ contractId: "invalid" }],
      outDir: "./generated",
    };
    expect(() => validateConfig(config3)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config3)).toThrow(/valid Stellar contract ID/);
  });

  it("should validate contract name field", () => {
    const config = {
      contracts: [
        {
          contractId: VALID_CONTRACT_ID_1,
          name: 123,
        },
      ],
      outDir: "./generated",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Must be a string if provided/);
  });

  it("should validate outDir field", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/outDir.*missing/);

    const config2 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: 123,
    };
    expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config2)).toThrow(/Must be a string/);
  });

  it("should validate network field", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      network: 123,
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Must be a string/);

    const config2 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      network: "invalid",
    };
    expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config2)).toThrow(/mainnet, testnet, futurenet/);
  });

  it("should validate optional fields", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      rpcUrl: 123,
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Must be a string/);
  });

  it("should validate registry fields", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      registryContractId: "invalid",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/valid Stellar contract ID/);

    const config2 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      registryPublisher: "invalid",
    };
    expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config2)).toThrow(/valid Stellar account ID/);

    // Test invalid registry fields with non-empty values
    const config3 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      registryContractId: "C123", // too short
    };
    expect(() => validateConfig(config3)).toThrow(ConfigValidationError);

    const config4 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
      registryPublisher: "G123", // too short
    };
    expect(() => validateConfig(config4)).toThrow(ConfigValidationError);
  });

  it("should validate duplicate contract IDs", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }, { contractId: VALID_CONTRACT_ID_1 }],
      outDir: "./generated",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Duplicate contract ID/);
  });

  it("should validate duplicate contract names", () => {
    const config = {
      contracts: [
        { contractId: VALID_CONTRACT_ID_1, name: "same" },
        { contractId: VALID_CONTRACT_ID_2, name: "same" },
      ],
      outDir: "./generated",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Duplicate contract name/);
  });

  it("should validate outDir safety", () => {
    const config = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "  ",
    };
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/empty or whitespace/);

    const config2 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "../dangerous",
    };
    expect(() => validateConfig(config2)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config2)).toThrow(/parent directory references/);

    const config3 = {
      contracts: [{ contractId: VALID_CONTRACT_ID_1 }],
      outDir: "/absolute/path",
    };
    expect(() => validateConfig(config3)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config3)).toThrow(/relative path/);
  });
});

describe("ConfigValidationError", () => {
  it("should create error with field and message", () => {
    const error = new ConfigValidationError("testField", "test message");
    expect(error.field).toBe("testField");
    expect(error.message).toBe("Invalid config field 'testField': test message");
    expect(error.name).toBe("ConfigValidationError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("Legacy functions", () => {
  it("loadCodegenConfig should return placeholder result", () => {
    const result = loadCodegenConfig("/test");
    expect(result.config).toBeNull();
    expect(result.lockFile).toBeNull();
    expect(result.errors).toEqual(["Use the new loadConfig function instead"]);
  });

  it("loadLockFile should return null", () => {
    const result = loadLockFile("/test");
    expect(result).toBeNull();
  });

  it("should handle edge case with contract without name", () => {
    const config = {
      contracts: [
        {
          contractId: VALID_CONTRACT_ID_1,
          // name field is optional
        },
      ],
      outDir: "./generated",
    };

    expect(() => validateConfig(config)).not.toThrow();
  });
});
