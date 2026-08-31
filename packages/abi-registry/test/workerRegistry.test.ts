import { describe, it, expect } from "vitest";
import { validateOperatorRecord, validateWorkerOfferingRecord } from "../src/types.js";
import type { OperatorRecord, WorkerOfferingRecord } from "../src/types.js";

const STELLAR_ADDR = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

function makeOperator(overrides: Partial<OperatorRecord> = {}): OperatorRecord {
  return {
    id: "test-operator",
    name: "Test Operator",
    stellarAddress: STELLAR_ADDR,
    contact: "operator@example.com",
    maintainer: "@test-operator",
    supportedTriggers: ["event", "schedule"],
    networks: ["testnet"],
    terms: {
      pricePerInvocation: 0.01,
      denomination: "USDC",
      dailyCap: 1000,
      slaMs: 5000,
    },
    latencyTier: "standard",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOffering(overrides: Partial<WorkerOfferingRecord> = {}): WorkerOfferingRecord {
  return {
    id: "test-offering",
    contractId: CONTRACT_ID,
    functionName: "swap",
    triggerClass: "event",
    terms: {
      pricePerInvocation: 0.01,
      denomination: "USDC",
      dailyCap: 1000,
      slaMs: 5000,
    },
    operatorId: "test-operator",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateOperatorRecord", () => {
  it("accepts a valid operator record", () => {
    expect(validateOperatorRecord(makeOperator())).toEqual({ valid: true });
  });

  it("accepts a record with optional terms.notes", () => {
    expect(
      validateOperatorRecord(
        makeOperator({ terms: { ...makeOperator().terms, notes: "Free tier available" } }),
      ),
    ).toEqual({ valid: true });
  });

  it("rejects a non-object", () => {
    expect(validateOperatorRecord(null)).toEqual({
      valid: false,
      errors: ["root: OperatorRecord must be an object"],
    });
  });

  it("rejects a missing required field", () => {
    const { id: _omitted, ...withoutId } = makeOperator();
    const result = validateOperatorRecord(withoutId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("id: must be a kebab-case slug");
    }
  });

  it("rejects a malformed id", () => {
    const result = validateOperatorRecord(makeOperator({ id: "INVALID_ID" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("id: must be a kebab-case slug");
    }
  });

  it("rejects a malformed stellarAddress", () => {
    const result = validateOperatorRecord(makeOperator({ stellarAddress: "not-a-g-address" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "stellarAddress: must be a G-prefixed 56-character Stellar strkey",
      );
    }
  });

  it("rejects empty supportedTriggers", () => {
    const result = validateOperatorRecord(makeOperator({ supportedTriggers: [] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("supportedTriggers: must be a non-empty array");
    }
  });

  it("rejects an invalid trigger class", () => {
    const result = validateOperatorRecord(
      makeOperator({
        supportedTriggers: ["event", "bogus" as OperatorRecord["supportedTriggers"][number]],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes('supportedTriggers: invalid trigger class "bogus"')),
      ).toBe(true);
    }
  });

  it("rejects an invalid network", () => {
    const result = validateOperatorRecord(
      makeOperator({
        networks: ["mainnet", "invalid-network" as OperatorRecord["networks"][number]],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes('networks: invalid network "invalid-network"')),
      ).toBe(true);
    }
  });

  it("rejects an invalid latencyTier", () => {
    const result = validateOperatorRecord(
      makeOperator({ latencyTier: "turbo" as OperatorRecord["latencyTier"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("latencyTier:"))).toBe(true);
    }
  });

  it("rejects a non-semver version", () => {
    const result = validateOperatorRecord(makeOperator({ version: "v1" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('version: must be a semver string (e.g. "1.0.0")');
    }
  });

  it("rejects a malformed createdAt timestamp", () => {
    const result = validateOperatorRecord(makeOperator({ createdAt: "not-a-date" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("createdAt: must be an ISO 8601 timestamp");
    }
  });

  it("rejects invalid terms: negative price", () => {
    const result = validateOperatorRecord(
      makeOperator({ terms: { ...makeOperator().terms, pricePerInvocation: -1 } }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("terms.pricePerInvocation: must be a non-negative number");
    }
  });

  it("rejects invalid terms: empty denomination", () => {
    const result = validateOperatorRecord(
      makeOperator({ terms: { ...makeOperator().terms, denomination: "" } }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("terms.denomination: must be a non-empty string");
    }
  });

  it("rejects invalid terms: negative dailyCap", () => {
    const result = validateOperatorRecord(
      makeOperator({ terms: { ...makeOperator().terms, dailyCap: -1 } }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("terms.dailyCap: must be a non-negative integer");
    }
  });

  it("accumulates every violation rather than stopping at the first", () => {
    const result = validateOperatorRecord({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("validateWorkerOfferingRecord", () => {
  it("accepts a valid offering record", () => {
    expect(validateWorkerOfferingRecord(makeOffering())).toEqual({ valid: true });
  });

  it("rejects a non-object", () => {
    expect(validateWorkerOfferingRecord(null)).toEqual({
      valid: false,
      errors: ["root: WorkerOfferingRecord must be an object"],
    });
  });

  it("rejects a missing required field", () => {
    const { id: _omitted, ...withoutId } = makeOffering();
    const result = validateWorkerOfferingRecord(withoutId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("id: must be a kebab-case slug");
    }
  });

  it("rejects a malformed contractId", () => {
    const result = validateWorkerOfferingRecord(makeOffering({ contractId: "not-a-contract" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "contractId: must be a C-prefixed 56-character Stellar strkey",
      );
    }
  });

  it("rejects an empty functionName", () => {
    const result = validateWorkerOfferingRecord(makeOffering({ functionName: "" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("functionName: must be a non-empty string");
    }
  });

  it("rejects an invalid triggerClass", () => {
    const result = validateWorkerOfferingRecord(
      makeOffering({ triggerClass: "webhook" as WorkerOfferingRecord["triggerClass"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("triggerClass:"))).toBe(true);
    }
  });

  it("rejects a non-semver version", () => {
    const result = validateWorkerOfferingRecord(makeOffering({ version: "v1" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('version: must be a semver string (e.g. "1.0.0")');
    }
  });

  it("rejects invalid terms", () => {
    const result = validateWorkerOfferingRecord(
      makeOffering({
        terms: { pricePerInvocation: -1, denomination: "USDC", dailyCap: 0, slaMs: 0 },
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("terms.pricePerInvocation: must be a non-negative number");
    }
  });

  it("accumulates every violation rather than stopping at the first", () => {
    const result = validateWorkerOfferingRecord({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});
