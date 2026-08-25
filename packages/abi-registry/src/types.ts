/**
 * Minimal XDR-backed contract spec - carries the raw on-chain entries.
 * For the rich ABI surface (functions, events, type descriptors) use
 * {@link ContractSpec} from `./spec.js`.
 */
export type XdrContractSpec = {
  contractId: string;
  /** Raw XDR entries as base64 strings. */
  entries: string[];
};

// ── Attestation documents ───────────────────────────────────────────────────
//
// See `schemas/attestation.schema.json` for the JSON Schema form of this type.

import type { EventSpec } from "./spec.js";
import { validateEventSpec } from "./spec.js";

/**
 * A claim that a deployed contract emits a given SEP-48-shaped event schema,
 * for contracts deployed before SEP-48/CAP-67 existed and so have no
 * embedded contract spec to derive this from (SEP §7.3). Signature-envelope
 * concerns (who signed it, tamper detection) are a separate layer - see
 * `signAttestation`/`verifyAttestation` in `attestation.ts` (SEP §7.4).
 */
export type AttestationDocument = {
  /** The attested contract's address (`C...`). */
  readonly contractId: string;
  /** Hex-encoded SHA-256 hash of the contract's deployed WASM bytecode. */
  readonly wasmHash: string;
  /** The SEP-48-shaped event definitions being attested to. */
  readonly events: readonly EventSpec[];
  /** The attester's Stellar account address (`G...`). */
  readonly attester: string;
  /** ISO 8601 timestamp of when the attestation was made. */
  readonly createdAt: string;
  /** ISO 8601 expiry timestamp, if the attestation is time-limited. */
  readonly expiresAt?: string;
  /** Hex-encoded hash of a prior attestation document this one supersedes, if any. */
  readonly supersedes?: string;
};

/** Result returned by {@link validateAttestationDocument}. */
export type AttestationValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly errors: ReadonlyArray<string> };

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID_RE = /^G[A-Z2-7]{55}$/;
const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates that `doc` conforms to the {@link AttestationDocument} shape and
 * all structural invariants (field formats, event-shape validity). Returns
 * an {@link AttestationValidationResult} - never throws.
 *
 * For full JSON Schema-based validation run the document through
 * `schemas/attestation.schema.json` using a JSON Schema validator such as Ajv.
 */
export function validateAttestationDocument(doc: unknown): AttestationValidationResult {
  const errors: string[] = [];

  if (!isRecord(doc)) {
    return { valid: false, errors: ["root: AttestationDocument must be an object"] };
  }

  if (typeof doc["contractId"] !== "string" || !CONTRACT_ID_RE.test(doc["contractId"])) {
    errors.push("contractId: must be a C-prefixed 56-character Stellar strkey");
  }
  if (typeof doc["wasmHash"] !== "string" || !SHA256_HEX_RE.test(doc["wasmHash"])) {
    errors.push("wasmHash: must be a 64-character hex-encoded SHA-256 hash");
  }
  if (!Array.isArray(doc["events"])) {
    errors.push("events: must be an array");
  } else {
    (doc["events"] as unknown[]).forEach((ev, i) => validateEventSpec(ev, `events[${i}]`, errors));
  }
  if (typeof doc["attester"] !== "string" || !ACCOUNT_ID_RE.test(doc["attester"])) {
    errors.push("attester: must be a G-prefixed 56-character Stellar strkey");
  }
  if (typeof doc["createdAt"] !== "string" || !ISO_8601_RE.test(doc["createdAt"])) {
    errors.push("createdAt: must be an ISO 8601 timestamp");
  }
  if (doc["expiresAt"] !== undefined) {
    if (typeof doc["expiresAt"] !== "string" || !ISO_8601_RE.test(doc["expiresAt"])) {
      errors.push("expiresAt: must be an ISO 8601 timestamp");
    }
  }
  if (doc["supersedes"] !== undefined) {
    if (typeof doc["supersedes"] !== "string" || !SHA256_HEX_RE.test(doc["supersedes"])) {
      errors.push("supersedes: must be a 64-character hex-encoded hash");
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export type AbiRegistryClientTransport = (
  input: RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export type AbiRegistryClientConfig = {
  /** Base URL of the hosted ABI registry, e.g. "https://abi.stellar.org". */
  baseUrl: string;
  /** Maximum number of specs to keep in the LRU cache. Defaults to 512. */
  maxCacheSize?: number;
  /** Time-to-live for cached specs in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number;
  /** Optional transport for HTTP requests; falls back to the global fetch implementation. */
  transport?: AbiRegistryClientTransport;
};
