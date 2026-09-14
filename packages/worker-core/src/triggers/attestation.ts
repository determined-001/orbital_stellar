/**
 * Attestation model for the off-chain-computation trigger class (issue
 * #1061, "20.7"), per `docs/design/worker-offchain-triggers.md`.
 *
 * Reuses `@orbital-stellar/abi-registry`'s attestation *envelope* -
 * `AttestationEnvelope<T>`, `signAttestation`, `verifyAttestation`,
 * `canonicalizeAttestation` - rather than inventing a second signing
 * concept, per that issue's own instruction. Only the *document* shape is
 * new: `ComputationAttestation` is unrelated to `AttestationDocument`
 * (which attests a contract's event schema), so it is its own type, signed
 * and verified through the same generic envelope machinery. See the design
 * note §3 for why the envelope is reusable but the document is not, and its
 * review-checklist item 1 for the open question of whether the envelope
 * should eventually live somewhere more central than `abi-registry`.
 */
import {
  signAttestation,
  verifyAttestation,
  type AttestationEnvelope,
} from "@orbital-stellar/abi-registry";

/**
 * What a computation source attests to (design note §3.1). Four properties
 * make this evidence rather than a claim (§2):
 *
 * 1. `attester` must be a source the worker's manifest declared *before*
 *    the fact - checked by {@link verifyComputationAttestation}'s caller,
 *    not by this module (it has no manifest to check against).
 * 2. `workerId` + `windowId` + `conditionId` bind the attestation to one
 *    specific window - {@link verifyComputationAttestation} checks this.
 * 3. Recorded with, or referenced by (via `resultHash`), the invocation -
 *    a chain-recording concern outside this module's scope (§4).
 * 4. Verifiable without contacting the source - true by construction, since
 *    verification is a pure signature check over this document.
 */
export type ComputationAttestation = {
  /** The attesting source's Stellar account address (`G...`). */
  readonly attester: string;
  /** Which worker definition this attestation is for. */
  readonly workerId: string;
  /** Binds this attestation to one obligation window - property 2. */
  readonly windowId: string;
  /** Which of the worker's declared off-chain conditions this asserts. */
  readonly conditionId: string;
  /** ISO 8601 - when the source observed the result. */
  readonly observedAt: string;
  /** The computation's output. Opaque to this module. */
  readonly result: unknown;
  /** Hex-encoded SHA-256 of the canonicalized `result` - what a reference-form invocation cites. */
  readonly resultHash: string;
  /** ISO 8601 - optional validity bound. */
  readonly expiresAt?: string;
};

export type ComputationAttestationEnvelope = AttestationEnvelope<ComputationAttestation>;

/** Signs a {@link ComputationAttestation}, producing a self-contained, offline-verifiable envelope. */
export function signComputationAttestation(
  document: ComputationAttestation,
  attesterSecret: string,
): ComputationAttestationEnvelope {
  return signAttestation(document, attesterSecret);
}

export type ComputationAttestationInvalidReason =
  "bad-signature" | "signer-not-declared" | "window-mismatch" | "condition-mismatch" | "expired";

export type VerifyComputationAttestationResult =
  | { readonly status: "valid" }
  | {
      readonly status: "invalid";
      readonly reason: ComputationAttestationInvalidReason;
      readonly detail: string;
    };

export type VerifyComputationAttestationOptions = {
  /**
   * The worker's manifest-declared source(s) for this condition - property
   * 1. Multiple entries are a quorum-eligible set, not a menu the attester
   * picks from after the fact; this function only checks membership, not
   * quorum semantics (design note §9, T4 - left for a future manifest
   * change).
   */
  readonly declaredSources: ReadonlyArray<string>;
  /** The window this attestation is being checked against - property 2. */
  readonly expectedWindowId: string;
  /** The condition this attestation is being checked against - property 2. */
  readonly expectedConditionId: string;
  /** Defaults to `new Date()`. Injectable so expiry checks stay deterministic in tests and replays. */
  readonly now?: Date;
};

/**
 * Verifies a {@link ComputationAttestationEnvelope} against the design
 * note's four evidence properties (§2), beyond what
 * {@link verifyAttestation} alone checks (signature validity and
 * envelope/payload attester agreement):
 *
 * 1. `envelope.publicKey` is one of `options.declaredSources`.
 * 2. `payload.windowId`/`payload.conditionId` match what the caller expects -
 *    catches replay of a genuine attestation across a different window.
 * 3. `payload.expiresAt`, if set, has not passed as of `options.now`.
 *
 * Checked in the above order; the first failure is returned.
 */
export function verifyComputationAttestation(
  envelope: ComputationAttestationEnvelope,
  options: VerifyComputationAttestationOptions,
): VerifyComputationAttestationResult {
  const signatureVerdict = verifyAttestation(envelope);
  if (signatureVerdict.status === "invalid") {
    return { status: "invalid", reason: "bad-signature", detail: signatureVerdict.reason };
  }

  if (!options.declaredSources.includes(envelope.publicKey)) {
    return {
      status: "invalid",
      reason: "signer-not-declared",
      detail: `"${envelope.publicKey}" is not among this worker's declared computation sources`,
    };
  }

  if (envelope.payload.windowId !== options.expectedWindowId) {
    return {
      status: "invalid",
      reason: "window-mismatch",
      detail: `attestation is for window "${envelope.payload.windowId}", expected "${options.expectedWindowId}"`,
    };
  }

  if (envelope.payload.conditionId !== options.expectedConditionId) {
    return {
      status: "invalid",
      reason: "condition-mismatch",
      detail: `attestation is for condition "${envelope.payload.conditionId}", expected "${options.expectedConditionId}"`,
    };
  }

  if (envelope.payload.expiresAt !== undefined) {
    const now = options.now ?? new Date();
    if (new Date(envelope.payload.expiresAt).getTime() < now.getTime()) {
      return {
        status: "invalid",
        reason: "expired",
        detail: `attestation expired at ${envelope.payload.expiresAt}`,
      };
    }
  }

  return { status: "valid" };
}
