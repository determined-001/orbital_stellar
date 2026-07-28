import { describe, expect, it } from "vitest";
import { validateTaxonomyRecord, parseTaxonomyRecord } from "../../src/taxonomy/index.js";
import { InvalidTaxonomyRecordError } from "../../src/taxonomy/index.js";

const VALID = {
  version: "1.0.0",
  mappings: [{ scope: { contractId: "C123" }, eventTopic: "transfer", semantic: "token.transferred" }],
};

describe("validateTaxonomyRecord", () => {
  it("accepts a well-formed record", () => {
    expect(validateTaxonomyRecord(VALID)).toEqual({ valid: true });
  });

  it("rejects a missing version", () => {
    const result = validateTaxonomyRecord({ mappings: VALID.mappings });
    expect(result.valid).toBe(false);
  });

  it("rejects a non-semver version string", () => {
    const result = validateTaxonomyRecord({ ...VALID, version: "v1" });
    expect(result.valid).toBe(false);
  });

  it("rejects mappings that isn't an array", () => {
    const result = validateTaxonomyRecord({ version: "1.0.0", mappings: "nope" });
    expect(result.valid).toBe(false);
  });

  it("rejects an empty eventTopic", () => {
    const result = validateTaxonomyRecord({
      version: "1.0.0",
      mappings: [{ scope: { contractId: "C" }, eventTopic: "", semantic: "token.transferred" }],
    });
    expect(result.valid).toBe(false);
  });

  it("accumulates multiple errors across mappings", () => {
    const result = validateTaxonomyRecord({
      version: "1.0.0",
      mappings: [
        { scope: { contractId: "C" }, eventTopic: "", semantic: "bad" },
        { scope: {}, eventTopic: "swap", semantic: "swap.executed" },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("parseTaxonomyRecord throws InvalidTaxonomyRecordError with the collected issues", () => {
    try {
      parseTaxonomyRecord({ version: "bad", mappings: [] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTaxonomyRecordError);
      expect((err as InstanceType<typeof InvalidTaxonomyRecordError>).issues.length).toBeGreaterThan(0);
    }
  });

  it("parseTaxonomyRecord returns the document unchanged when valid", () => {
    expect(parseTaxonomyRecord(VALID)).toEqual(VALID);
  });
});
