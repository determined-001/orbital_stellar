import { describe, it, expect } from "vitest";
import { validateAttestationDocument } from "../src/types.js";
import type { AttestationDocument } from "../src/types.js";

const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const ATTESTER = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const WASM_HASH = "a".repeat(64);

function makeDocument(overrides: Partial<AttestationDocument> = {}): AttestationDocument {
  return {
    contractId: CONTRACT_ID,
    wasmHash: WASM_HASH,
    events: [
      {
        name: "transfer",
        topics: [{ name: "from", type: "address" }],
        data: [{ name: "amount", type: "i128" }],
      },
    ],
    attester: ATTESTER,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateAttestationDocument", () => {
  it("accepts a valid document", () => {
    expect(validateAttestationDocument(makeDocument())).toEqual({ valid: true });
  });

  it("accepts a valid document with expiresAt and supersedes", () => {
    const doc = makeDocument({
      expiresAt: "2027-01-01T00:00:00Z",
      supersedes: "b".repeat(64),
    });
    expect(validateAttestationDocument(doc)).toEqual({ valid: true });
  });

  it("rejects a non-object", () => {
    expect(validateAttestationDocument(null)).toEqual({
      valid: false,
      errors: ["root: AttestationDocument must be an object"],
    });
    expect(validateAttestationDocument("not a document")).toEqual({
      valid: false,
      errors: ["root: AttestationDocument must be an object"],
    });
  });

  it("rejects a document missing a required field", () => {
    const { contractId: _omitted, ...withoutContractId } = makeDocument();
    const result = validateAttestationDocument(withoutContractId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "contractId: must be a C-prefixed 56-character Stellar strkey",
      );
    }
  });

  it("rejects a malformed wasmHash", () => {
    const result = validateAttestationDocument(makeDocument({ wasmHash: "not-a-hash" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("wasmHash: must be a 64-character hex-encoded SHA-256 hash");
    }
  });

  it("rejects a malformed contractId", () => {
    const result = validateAttestationDocument(makeDocument({ contractId: "not-a-contract-id" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "contractId: must be a C-prefixed 56-character Stellar strkey",
      );
    }
  });

  it("rejects a malformed attester address", () => {
    const result = validateAttestationDocument(makeDocument({ attester: "not-a-g-address" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("attester: must be a G-prefixed 56-character Stellar strkey");
    }
  });

  it("rejects a malformed createdAt timestamp", () => {
    const result = validateAttestationDocument(makeDocument({ createdAt: "not-a-date" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("createdAt: must be an ISO 8601 timestamp");
    }
  });

  it("rejects a malformed supersedes hash", () => {
    const result = validateAttestationDocument(makeDocument({ supersedes: "not-a-hash" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("supersedes: must be a 64-character hex-encoded hash");
    }
  });

  it("rejects events that aren't an array", () => {
    const result = validateAttestationDocument({
      ...makeDocument(),
      events: "not-an-array",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("events: must be an array");
    }
  });

  it("rejects a malformed event definition, reusing EventSpec validation", () => {
    const result = validateAttestationDocument(
      makeDocument({
        events: [{ name: "transfer" } as unknown as AttestationDocument["events"][number]],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("events[0].topics: must be an array");
      expect(result.errors).toContain("events[0].data: must be an array");
    }
  });

  it("accumulates every violation rather than stopping at the first", () => {
    const result = validateAttestationDocument({
      contractId: "bad",
      wasmHash: "bad",
      events: "bad",
      attester: "bad",
      createdAt: "bad",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});
