import { describe, it, expect } from "vitest";
import { BatchGenerationError, generateBatchTypes, checkForDrift } from "../src/batchGeneration.js";
import type { OrbitalConfig } from "../src/config.js";

const VALID_CONTRACT_ID = "C" + "A".repeat(55);

describe("batchGeneration", () => {
  describe("BatchGenerationError", () => {
    it("should create error with message and optional contractId", () => {
      const error = new BatchGenerationError("test message", "CTEST");
      expect(error.message).toBe("test message");
      expect(error.contractId).toBe("CTEST");
      expect(error.name).toBe("BatchGenerationError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with message only", () => {
      const error = new BatchGenerationError("test message");
      expect(error.message).toBe("test message");
      expect(error.contractId).toBeUndefined();
    });
  });

  describe("generateBatchTypes", () => {
    it("should be a function", () => {
      expect(typeof generateBatchTypes).toBe("function");
    });
  });

  describe("checkForDrift", () => {
    it("should be a function", () => {
      expect(typeof checkForDrift).toBe("function");
    });
  });
});
