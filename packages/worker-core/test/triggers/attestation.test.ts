import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  signComputationAttestation,
  verifyComputationAttestation,
  type ComputationAttestation,
} from "../../src/triggers/attestation.js";

function makeDocument(
  attester: string,
  overrides: Partial<ComputationAttestation> = {},
): ComputationAttestation {
  return {
    attester,
    workerId: "payroll-w1",
    windowId: "payroll-w1:c:occ-1",
    conditionId: "oracle-resolution",
    observedAt: "2026-01-01T00:00:00Z",
    result: { price: "1.23" },
    resultHash: "a".repeat(64),
    ...overrides,
  };
}

describe("verifyComputationAttestation", () => {
  it("accepts a validly-signed attestation from a declared source, bound to the expected window/condition", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(makeDocument(source.publicKey()), source.secret());

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toEqual({ status: "valid" });
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(makeDocument(source.publicKey()), source.secret());
    const tampered = { ...envelope, payload: { ...envelope.payload, result: { price: "999.99" } } };

    const result = verifyComputationAttestation(tampered, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toMatchObject({ status: "invalid", reason: "bad-signature" });
  });

  it("rejects a validly-signed attestation from a source not in the manifest's declared set", () => {
    const source = Keypair.random();
    const someoneElse = Keypair.random();
    const envelope = signComputationAttestation(makeDocument(source.publicKey()), source.secret());

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [someoneElse.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toMatchObject({ status: "invalid", reason: "signer-not-declared" });
  });

  it("rejects a genuine attestation replayed against a different window (T3 in the security review)", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(
      makeDocument(source.publicKey(), { windowId: "payroll-w1:c:occ-1" }),
      source.secret(),
    );

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-2",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toMatchObject({ status: "invalid", reason: "window-mismatch" });
  });

  it("rejects an attestation for a different declared condition", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(
      makeDocument(source.publicKey(), { conditionId: "some-other-condition" }),
      source.secret(),
    );

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toMatchObject({ status: "invalid", reason: "condition-mismatch" });
  });

  it("rejects an expired attestation", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(
      makeDocument(source.publicKey(), { expiresAt: "2026-01-01T00:00:00Z" }),
      source.secret(),
    );

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(result).toMatchObject({ status: "invalid", reason: "expired" });
  });

  it("accepts an attestation with an expiresAt that has not yet passed", () => {
    const source = Keypair.random();
    const envelope = signComputationAttestation(
      makeDocument(source.publicKey(), { expiresAt: "2026-01-03T00:00:00Z" }),
      source.secret(),
    );

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [source.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(result).toEqual({ status: "valid" });
  });

  it("checks membership against a quorum-eligible set of multiple declared sources", () => {
    const sourceA = Keypair.random();
    const sourceB = Keypair.random();
    const envelope = signComputationAttestation(
      makeDocument(sourceB.publicKey()),
      sourceB.secret(),
    );

    const result = verifyComputationAttestation(envelope, {
      declaredSources: [sourceA.publicKey(), sourceB.publicKey()],
      expectedWindowId: "payroll-w1:c:occ-1",
      expectedConditionId: "oracle-resolution",
    });

    expect(result).toEqual({ status: "valid" });
  });
});
