/**
 * Signing and verification for attestation documents (issue #21 / SEP §7.4):
 * "here is the event schema this deployed contract actually emits, attested
 * by X". This module only concerns itself with the signature envelope -
 * proving who signed a given document and that it hasn't been tampered with
 * since. The document shape itself (`AttestationDocument`) is #20's
 * deliverable, imported from `types.ts`; everything here is shape-agnostic
 * (it only reads `attester` and `wasmHash` directly, and otherwise treats
 * the document as an opaque value to canonicalize/sign/verify).
 */
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { AttestationDocument } from "./types.js";

/** An {@link AttestationDocument} bundled with proof of who signed it. */
export interface AttestationEnvelope {
  payload: AttestationDocument;
  /** The signer's Stellar account address (`G...`). */
  publicKey: string;
  /** Base64-encoded ed25519 signature over {@link canonicalizeAttestation}'s output for `payload`. */
  signature: string;
}

/**
 * Deterministically serializes an {@link AttestationDocument} to JSON with
 * object keys sorted recursively, so semantically identical documents always
 * produce identical signing bytes regardless of property insertion order.
 * Mirrors {@link canonicalizeSpec} in `spec.ts` for the same reason: a
 * verifier must be able to re-derive the exact bytes that were signed.
 */
export function canonicalizeAttestation(document: AttestationDocument): string {
  return JSON.stringify(sortKeysDeep(document));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/** Thrown by {@link signAttestation} when the signing key or document is malformed. */
export class AttestationSigningError extends Error {
  constructor(reason: string) {
    super(`[abi-registry] failed to sign attestation: ${reason}`);
    this.name = "AttestationSigningError";
  }
}

/**
 * Signs an {@link AttestationDocument} with an ed25519 Stellar keypair,
 * producing a self-contained {@link AttestationEnvelope}.
 *
 * @param document The attestation to sign. `document.attester` must match
 *   the public key derived from `attesterSecret` - the whole point of the
 *   envelope is that the claimed attester and the actual signer are the same
 *   account, so a mismatch here would produce an envelope that always fails
 *   {@link verifyAttestation}'s attester-match check.
 * @param attesterSecret The attester's Stellar secret key (`S...`).
 * @throws {AttestationSigningError} if `attesterSecret` isn't a valid Stellar
 *   secret key, or if it doesn't correspond to `document.attester`.
 */
export function signAttestation(
  document: AttestationDocument,
  attesterSecret: string,
): AttestationEnvelope {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(attesterSecret);
  } catch (cause) {
    throw new AttestationSigningError(`invalid secret key: ${String(cause)}`);
  }

  if (keypair.publicKey() !== document.attester) {
    throw new AttestationSigningError(
      `document.attester ("${document.attester}") does not match the signing key's address ("${keypair.publicKey()}")`,
    );
  }

  const payloadBytes = Buffer.from(canonicalizeAttestation(document), "utf8");
  const signature = keypair.sign(payloadBytes);

  return {
    payload: document,
    publicKey: keypair.publicKey(),
    signature: signature.toString("base64"),
  };
}

/** A verification outcome for {@link verifyAttestation}: either valid, or invalid with a reason. */
export type AttestationVerdict = { status: "valid" } | { status: "invalid"; reason: string };

export type VerifyAttestationOptions = {
  /**
   * The attested contract's actual on-chain WASM hash (hex-encoded), fetched
   * independently by the caller (this module makes no network calls).  When
   * provided, it must match `envelope.payload.wasmHash` exactly (case-insensitive).
   */
  expectedWasmHash?: string;
};

/**
 * Verifies an {@link AttestationEnvelope} against SEP §7.4's rules:
 *
 * 1. `envelope.publicKey` is a well-formed Stellar account address (`G...`).
 * 2. `envelope.publicKey` matches `envelope.payload.attester` - the envelope
 *    can't be signed by anyone other than who the document claims attested it.
 * 3. `envelope.signature` is a valid ed25519 signature by `envelope.publicKey`
 *    over {@link canonicalizeAttestation}'s output for `envelope.payload` -
 *    this also catches any tampering with the payload after signing, since
 *    a single changed byte produces different canonical JSON.
 * 4. If `options.expectedWasmHash` is given, it matches `envelope.payload.wasmHash`.
 *
 * Rules are checked in the above order and verification short-circuits on
 * the first failure.
 */
export function verifyAttestation(
  envelope: AttestationEnvelope,
  options: VerifyAttestationOptions = {},
): AttestationVerdict {
  if (!StrKey.isValidEd25519PublicKey(envelope.publicKey)) {
    return {
      status: "invalid",
      reason: `publicKey "${envelope.publicKey}" is not a valid Stellar account address`,
    };
  }

  if (envelope.publicKey !== envelope.payload.attester) {
    return {
      status: "invalid",
      reason: `envelope.publicKey ("${envelope.publicKey}") does not match payload.attester ("${envelope.payload.attester}")`,
    };
  }

  let keypair: Keypair;
  let signatureBytes: Buffer;
  try {
    keypair = Keypair.fromPublicKey(envelope.publicKey);
    signatureBytes = Buffer.from(envelope.signature, "base64");
  } catch (cause) {
    return { status: "invalid", reason: `malformed public key or signature: ${String(cause)}` };
  }

  const payloadBytes = Buffer.from(canonicalizeAttestation(envelope.payload), "utf8");
  let signatureValid: boolean;
  try {
    signatureValid = keypair.verify(payloadBytes, signatureBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { status: "invalid", reason: "signature does not match payload and publicKey" };
  }

  if (
    options.expectedWasmHash !== undefined &&
    options.expectedWasmHash.toLowerCase() !== envelope.payload.wasmHash.toLowerCase()
  ) {
    return {
      status: "invalid",
      reason: `payload.wasmHash ("${envelope.payload.wasmHash}") does not match the on-chain WASM hash ("${options.expectedWasmHash}")`,
    };
  }

  return { status: "valid" };
}
