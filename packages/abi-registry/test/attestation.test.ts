import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  signAttestation,
  verifyAttestation,
  canonicalizeAttestation,
  AttestationSigningError,
} from "../src/attestation.js";
import type { AttestationEnvelope } from "../src/attestation.js";
import type { AttestationDocument } from "../src/types.js";

const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const WASM_HASH = "a".repeat(64);

function makeDocument(
  attester: string,
  overrides: Partial<AttestationDocument> = {},
): AttestationDocument {
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
    attester,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("canonicalizeAttestation", () => {
  it("produces identical output regardless of key insertion order", () => {
    const attester = Keypair.random().publicKey();
    const a = makeDocument(attester);
    const b: AttestationDocument = {
      createdAt: a.createdAt,
      attester: a.attester,
      events: a.events,
      wasmHash: a.wasmHash,
      contractId: a.contractId,
    };

    expect(canonicalizeAttestation(a)).toBe(canonicalizeAttestation(b));
  });

  it("produces different output when a field changes", () => {
    const attester = Keypair.random().publicKey();
    const a = makeDocument(attester);
    const b = makeDocument(attester, { wasmHash: "b".repeat(64) });

    expect(canonicalizeAttestation(a)).not.toBe(canonicalizeAttestation(b));
  });
});

describe("signAttestation / verifyAttestation round trip", () => {
  it("verifies a freshly signed envelope as valid", () => {
    const keypair = Keypair.random();
    const document = makeDocument(keypair.publicKey());

    const envelope = signAttestation(document, keypair.secret());

    expect(envelope.publicKey).toBe(keypair.publicKey());
    expect(verifyAttestation(envelope)).toEqual({ status: "valid" });
  });

  it("verifies against a matching expectedWasmHash", () => {
    const keypair = Keypair.random();
    const document = makeDocument(keypair.publicKey());
    const envelope = signAttestation(document, keypair.secret());

    expect(verifyAttestation(envelope, { expectedWasmHash: WASM_HASH })).toEqual({
      status: "valid",
    });
    // Case-insensitive comparison.
    expect(verifyAttestation(envelope, { expectedWasmHash: WASM_HASH.toUpperCase() })).toEqual({
      status: "valid",
    });
  });

  it("rejects when document.attester doesn't match the signing key", () => {
    const keypair = Keypair.random();
    const otherAttester = Keypair.random().publicKey();
    const document = makeDocument(otherAttester);

    expect(() => signAttestation(document, keypair.secret())).toThrow(AttestationSigningError);
  });

  it("rejects an invalid secret key", () => {
    const document = makeDocument(Keypair.random().publicKey());
    expect(() => signAttestation(document, "not-a-secret-key")).toThrow(AttestationSigningError);
  });
});

describe("verifyAttestation rejection rules", () => {
  it("rejects a tampered payload (signature no longer matches)", () => {
    const keypair = Keypair.random();
    const document = makeDocument(keypair.publicKey());
    const envelope = signAttestation(document, keypair.secret());

    const tampered: AttestationEnvelope = {
      ...envelope,
      payload: { ...envelope.payload, wasmHash: "c".repeat(64) },
    };

    expect(verifyAttestation(tampered)).toEqual({
      status: "invalid",
      reason: expect.stringContaining("signature"),
    });
  });

  it("rejects a signature produced by the wrong key", () => {
    const signer = Keypair.random();
    const impersonated = Keypair.random();
    // Document claims `impersonated` attested it, but `signer` signs it -
    // signAttestation itself would refuse this (attester must match the
    // signing key), so construct the mismatched envelope directly to
    // exercise verifyAttestation's own check.
    const document = makeDocument(impersonated.publicKey());
    const payloadBytes = Buffer.from(canonicalizeAttestation(document), "utf8");
    const envelope: AttestationEnvelope = {
      payload: document,
      publicKey: signer.publicKey(),
      signature: signer.sign(payloadBytes).toString("base64"),
    };

    expect(verifyAttestation(envelope)).toEqual({
      status: "invalid",
      reason: expect.stringContaining("does not match payload.attester"),
    });
  });

  it("rejects a signature that verifies against a different key entirely", () => {
    const signer = Keypair.random();
    const claimedSigner = Keypair.random();
    const document = makeDocument(claimedSigner.publicKey());
    const payloadBytes = Buffer.from(canonicalizeAttestation(document), "utf8");

    // publicKey matches payload.attester (passes the attester-match check),
    // but the signature bytes were actually produced by a different key.
    const envelope: AttestationEnvelope = {
      payload: document,
      publicKey: claimedSigner.publicKey(),
      signature: signer.sign(payloadBytes).toString("base64"),
    };

    expect(verifyAttestation(envelope)).toEqual({
      status: "invalid",
      reason: expect.stringContaining("signature"),
    });
  });

  it("rejects a malformed publicKey", () => {
    const keypair = Keypair.random();
    const document = makeDocument(keypair.publicKey());
    const envelope = signAttestation(document, keypair.secret());

    const malformed: AttestationEnvelope = { ...envelope, publicKey: "not-a-valid-address" };

    expect(verifyAttestation(malformed)).toEqual({
      status: "invalid",
      reason: expect.stringContaining("not a valid Stellar account address"),
    });
  });

  it("rejects a mismatched expectedWasmHash", () => {
    const keypair = Keypair.random();
    const document = makeDocument(keypair.publicKey());
    const envelope = signAttestation(document, keypair.secret());

    expect(verifyAttestation(envelope, { expectedWasmHash: "d".repeat(64) })).toEqual({
      status: "invalid",
      reason: expect.stringContaining("does not match the on-chain WASM hash"),
    });
  });
});
