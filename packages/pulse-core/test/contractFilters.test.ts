import { describe, it, expect } from "vitest";
import { validateContractFilters } from "../src/contractFilters.js";

describe("validateContractFilters", () => {
  describe("filters array validation", () => {
    it("returns null for valid empty filters array", () => {
      const result = validateContractFilters([]);
      expect(result).toBeNull();
    });

    it("returns null for filters that is not an array", () => {
      const result = validateContractFilters(null);
      expect(result).toEqual(["Filters must be an array"]);
    });

    it("returns null for filters that is not an array (object)", () => {
      const result = validateContractFilters({ filters: [] });
      expect(result).toEqual(["Filters must be an array"]);
    });

    it("returns null for filters that is not an array (string)", () => {
      const result = validateContractFilters("not an array");
      expect(result).toEqual(["Filters must be an array"]);
    });

    it("returns error when filters.length > 5", () => {
      const filters = [{}, {}, {}, {}, {}, {}]; // 6 filters
      const result = validateContractFilters(filters);
      expect(result).toContain("Filters array length must be ≤ 5, but got 6");
    });

    it("returns null for filters with exactly 5 items", () => {
      const filters = [{}, {}, {}, {}, {}];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });
  });

  describe("filter type validation", () => {
    it("returns null when type is omitted", () => {
      const filters = [{ contractIds: ["CABC1234"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts type 'contract.invoked'", () => {
      const filters = [{ type: "contract.invoked" }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts type 'contract.emitted'", () => {
      const filters = [{ type: "contract.emitted" }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("rejects invalid type", () => {
      const filters = [{ type: "invalid.type" }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        'Filter[0].type must be "contract.invoked" or "contract.emitted"'
      );
    });

    it("rejects non-string type", () => {
      const filters = [{ type: 123 }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        'Filter[0].type must be "contract.invoked" or "contract.emitted"'
      );
    });
  });

  describe("contractIds validation", () => {
    it("returns null when contractIds is omitted", () => {
      const filters = [{ type: "contract.invoked" }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns error when contractIds is not an array", () => {
      const filters = [{ contractIds: "not an array" }];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter[0].contractIds must be an array");
    });

    it("returns null for empty contractIds array", () => {
      const filters = [{ contractIds: [] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for contractIds with 1 item", () => {
      const filters = [{ contractIds: ["CABC1234"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for contractIds with exactly 5 items", () => {
      const filters = [
        {
          contractIds: ["C1", "C2", "C3", "C4", "C5"],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns error when contractIds.length > 5", () => {
      const filters = [
        {
          contractIds: ["C1", "C2", "C3", "C4", "C5", "C6"],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        "Filter[0].contractIds length must be ≤ 5, but got 6"
      );
    });

    it("returns error when contractIds contains non-string", () => {
      const filters = [{ contractIds: ["CABC1234", 123] }];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter[0].contractIds[1] must be a string");
    });

    it("returns error when contractIds contains null", () => {
      const filters = [{ contractIds: ["CABC1234", null] }];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter[0].contractIds[1] must be a string");
    });

    it("returns multiple errors for multiple invalid contractIds", () => {
      const filters = [{ contractIds: [123, null, true] }];
      const result = validateContractFilters(filters);
      expect(result).toHaveLength(3);
      expect(result).toContain("Filter[0].contractIds[0] must be a string");
      expect(result).toContain("Filter[0].contractIds[1] must be a string");
      expect(result).toContain("Filter[0].contractIds[2] must be a string");
    });
  });

  describe("topicFilters validation", () => {
    it("returns null when topicFilters is omitted", () => {
      const filters = [{ contractIds: ["CABC1234"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns error when topicFilters is not an array", () => {
      const filters = [{ topicFilters: "not an array" }];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter[0].topicFilters must be an array");
    });

    it("returns null for empty topicFilters array", () => {
      const filters = [{ topicFilters: [] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts null as wildcard in topicFilters", () => {
      const filters = [{ topicFilters: [null] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts multiple null wildcards", () => {
      const filters = [{ topicFilters: [null, null, null] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts '*' single-segment wildcard", () => {
      const filters = [{ topicFilters: ["*"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts '**' multi-segment wildcard", () => {
      const filters = [{ topicFilters: ["**"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts base64-encoded XDR scval", () => {
      const filters = [{ topicFilters: ["AAAADwAAAAV0cmFuc2Zlcg=="] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts mixed valid topic patterns", () => {
      const filters = [
        {
          topicFilters: [
            "*",
            "**",
            null,
            "AAAADwAAAAV0cmFuc2Zlcg==",
          ],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("rejects non-string, non-null topic", () => {
      const filters = [{ topicFilters: [123] }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        "Filter[0].topicFilters[0] must be null or a string"
      );
    });

    it("rejects boolean topic", () => {
      const filters = [{ topicFilters: [true] }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        "Filter[0].topicFilters[0] must be null or a string"
      );
    });

    it("rejects invalid string topic (not *, **, or base64)", () => {
      const filters = [{ topicFilters: ["invalid!topic"] }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        "Filter[0].topicFilters[0] must be '*', '**', or a base64-encoded XDR scval, but got 'invalid!topic'"
      );
    });

    it("rejects string with invalid characters for base64", () => {
      const filters = [{ topicFilters: ["abc!def"] }];
      const result = validateContractFilters(filters);
      expect(result?.length).toBeGreaterThan(0);
    });

    it("rejects empty string topic", () => {
      const filters = [{ topicFilters: [""] }];
      const result = validateContractFilters(filters);
      expect(result).toContain(
        "Filter[0].topicFilters[0] must be '*', '**', or a base64-encoded XDR scval, but got ''"
      );
    });

    it("rejects malformed base64 with invalid padding", () => {
      const filters = [{ topicFilters: ["abc=d"] }];
      const result = validateContractFilters(filters);
      expect(result?.length).toBeGreaterThan(0);
    });

    it("accepts valid base64 with proper padding", () => {
      const filters = [{ topicFilters: ["YQ=="] }]; // "a" in base64
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts valid base64 without padding", () => {
      const filters = [{ topicFilters: ["YWJj"] }]; // "abc" in base64
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accepts base64 with +/ characters", () => {
      const filters = [{ topicFilters: ["YWJjK2QvZQ=="] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });
  });

  describe("complex filter scenarios", () => {
    it("returns null for valid complex filter", () => {
      const filters = [
        {
          type: "contract.invoked",
          contractIds: ["CABC1234", "CXYZ9999"],
          topicFilters: ["*", null, "AAAADwAAAAV0cmFuc2Zlcg=="],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for filter with only contractId", () => {
      const filters = [{ contractIds: ["CABC1234"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for filter with only type", () => {
      const filters = [{ type: "contract.emitted" }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for filter with only topicFilters", () => {
      const filters = [{ topicFilters: ["*"] }];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("returns null for empty filter object", () => {
      const filters = [{}];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("accumulates errors from multiple filters", () => {
      const filters = [
        { contractIds: ["C1", "C2", "C3", "C4", "C5", "C6"] }, // too many
        { type: "invalid.type" },
        { topicFilters: [999] }, // invalid type
      ];
      const result = validateContractFilters(filters);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(2);
    });

    it("returns error for non-object filter item", () => {
      const filters = ["not an object"] as unknown as any[];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter at index 0 must be an object");
    });

    it("returns error for null filter item", () => {
      const filters = [null] as unknown as any[];
      const result = validateContractFilters(filters);
      expect(result).toContain("Filter at index 0 must be an object");
    });

    it("returns multiple errors from a single invalid filter", () => {
      const filters = [
        {
          type: "bad.type",
          contractIds: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
          topicFilters: [123, "invalid!"],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("integration with EventEngine", () => {
    it("example: valid subscription filters", () => {
      const filters = [
        {
          contractIds: ["CABC1234"],
          topicFilters: ["transfer"],
        },
        {
          type: "contract.emitted",
          contractIds: ["CXYZ9999", "CPQR1111"],
          topicFilters: ["*", null],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).toBeNull();
    });

    it("example: invalid - too many filters", () => {
      const filters = Array(6)
        .fill(null)
        .map((_, i) => ({ contractIds: [`C${i}`] }));
      const result = validateContractFilters(filters);
      expect(result).not.toBeNull();
    });

    it("example: invalid - too many contract IDs", () => {
      const filters = [
        {
          contractIds: ["C1", "C2", "C3", "C4", "C5", "C6"],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).not.toBeNull();
    });

    it("example: invalid - invalid topic pattern", () => {
      const filters = [
        {
          topicFilters: ["valid", "???invalid???"],
        },
      ];
      const result = validateContractFilters(filters);
      expect(result).not.toBeNull();
    });
  });
});
