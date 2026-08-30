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
 * What kind of executable the attested contract runs, mirroring the real
 * on-chain `ContractExecutable` XDR union. `"wasm"` contracts have a
 * deployed WASM blob and therefore a `wasmHash`. `"stellarAsset"` contracts
 * (SACs - the wrappers behind every classic Stellar asset, including native
 * XLM) run the network's built-in executable and have **no** WASM to hash -
 * confirmed against a live mainnet `ContractExecutable` entry, whose
 * `stellarAsset` variant carries no hash payload at all, not even a
 * network-wide constant one.
 */
export type AttestationExecutableKind = "wasm" | "stellarAsset";

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
  /** What kind of executable the attested contract runs. */
  readonly executableKind: AttestationExecutableKind;
  /**
   * Hex-encoded SHA-256 hash of the contract's deployed WASM bytecode.
   * Required when `executableKind` is `"wasm"`; must be absent when it's
   * `"stellarAsset"`, since SACs have no WASM to hash.
   */
  readonly wasmHash?: string;
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
  if (doc["executableKind"] !== "wasm" && doc["executableKind"] !== "stellarAsset") {
    errors.push('executableKind: must be "wasm" or "stellarAsset"');
  } else if (doc["executableKind"] === "wasm") {
    if (typeof doc["wasmHash"] !== "string" || !SHA256_HEX_RE.test(doc["wasmHash"])) {
      errors.push(
        'wasmHash: must be a 64-character hex-encoded SHA-256 hash (required when executableKind is "wasm")',
      );
    }
  } else if (doc["wasmHash"] !== undefined) {
    errors.push(
      'wasmHash: must not be present when executableKind is "stellarAsset" (SACs have no WASM to hash)',
    );
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

// ── Worker registry records ─────────────────────────────────────────────────
//
// See `schema/operator.schema.json` and `schema/worker-offering.schema.json`
// for the JSON Schema forms of these types.
//
// Orbital is the registry, standard, and verification layer - not the guarantor
// of anyone's execution. No field in these records asserts or implies an
// Orbital guarantee of execution.

/**
 * The class of trigger a worker service responds to. Each class maps to a
 * distinct invocation mechanism (event, schedule, HTTP, manual).
 */
export type TriggerClass = "event" | "schedule" | "http" | "manual";

/**
 * Self-declared latency tier for an operator, indicating their typical
 * response time. Operators self-declare; this is not verified by Orbital.
 */
export type LatencyTier = "realtime" | "low" | "standard" | "bulk";

/**
 * Structured service terms offered by an operator. Comparable across operators
 * because they are data, not prose.
 */
export type OperatorTerms = {
  /** Price per invocation in the specified denomination. */
  readonly pricePerInvocation: number;
  /** Denomination for the price (e.g. "USD", "XLM", "USDC"). */
  readonly denomination: string;
  /** Maximum number of invocations per day, or 0 for unlimited. */
  readonly dailyCap: number;
  /** SLA response time in milliseconds, or 0 if no SLA is offered. */
  readonly slaMs: number;
  /** Free-form notes about terms (max 500 chars). */
  readonly notes?: string;
};

/**
 * A worker registry operator record (§C.4). Describes who offers worker
 * services, which trigger types they handle, on what networks, and under
 * what terms.
 *
 * This record is self-declared operator metadata. Orbital verifies identity
 * and contact but does **not** guarantee execution quality, uptime, or
 * correctness of the declared terms.
 */
export type OperatorRecord = {
  /** Unique operator identifier (kebab-case slug). */
  readonly id: string;
  /** Human-readable operator name. */
  readonly name: string;
  /** Operator's Stellar account address (`G...`) for on-chain identity. */
  readonly stellarAddress: string;
  /** Contact email or URL for the operator. */
  readonly contact: string;
  /** GitHub handle or other identifier for the operator maintainer. */
  readonly maintainer: string;
  /** Supported trigger classes this operator handles. */
  readonly supportedTriggers: readonly TriggerClass[];
  /** Networks this operator operates on. */
  readonly networks: readonly ("mainnet" | "testnet" | "futurenet")[];
  /** Structured service terms. */
  readonly terms: OperatorTerms;
  /** Self-declared latency tier. */
  readonly latencyTier: LatencyTier;
  /** Semantic version of this record. Increments on any change. */
  readonly version: string;
  /** ISO 8601 timestamp of when this record was created. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of the most recent update. */
  readonly updatedAt: string;
};

/**
 * A worker registry offering record (§C.4). Describes a specific worker
 * service: which contract/function it targets, what trigger class it uses,
 * what it costs, and which operator provides it.
 *
 * This record is operator-declared metadata. Orbital verifies the operator
 * identity and contract existence but does **not** guarantee the worker's
 * execution correctness or availability.
 */
export type WorkerOfferingRecord = {
  /** Unique offering identifier (kebab-case slug). */
  readonly id: string;
  /** The target contract address (`C...`) this worker invokes. */
  readonly contractId: string;
  /** The function name on the target contract this worker invokes. */
  readonly functionName: string;
  /** The trigger class this offering responds to. */
  readonly triggerClass: TriggerClass;
  /** Structured service terms for this offering. */
  readonly terms: OperatorTerms;
  /** The operator providing this offering (references OperatorRecord.id). */
  readonly operatorId: string;
  /** Semantic version of this record. Increments on any change. */
  readonly version: string;
  /** ISO 8601 timestamp of when this record was created. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of the most recent update. */
  readonly updatedAt: string;
};

/** Result returned by {@link validateOperatorRecord}. */
export type OperatorValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly errors: ReadonlyArray<string> };

/** Result returned by {@link validateWorkerOfferingRecord}. */
export type WorkerOfferingValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly errors: ReadonlyArray<string> };

const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const VALID_TRIGGER_CLASSES: readonly TriggerClass[] = ["event", "schedule", "http", "manual"];
const VALID_LATENCY_TIERS: readonly LatencyTier[] = ["realtime", "low", "standard", "bulk"];
const VALID_NETWORKS = ["mainnet", "testnet", "futurenet"] as const;

function validateOperatorTerms(terms: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(terms)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }
  if (typeof terms["pricePerInvocation"] !== "number" || terms["pricePerInvocation"] < 0) {
    errors.push(`${prefix}.pricePerInvocation: must be a non-negative number`);
  }
  if (typeof terms["denomination"] !== "string" || terms["denomination"].length === 0) {
    errors.push(`${prefix}.denomination: must be a non-empty string`);
  }
  if (typeof terms["dailyCap"] !== "number" || terms["dailyCap"] < 0 || !Number.isInteger(terms["dailyCap"])) {
    errors.push(`${prefix}.dailyCap: must be a non-negative integer`);
  }
  if (typeof terms["slaMs"] !== "number" || terms["slaMs"] < 0 || !Number.isInteger(terms["slaMs"])) {
    errors.push(`${prefix}.slaMs: must be a non-negative integer`);
  }
  if (terms["notes"] !== undefined) {
    if (typeof terms["notes"] !== "string" || terms["notes"].length > 500) {
      errors.push(`${prefix}.notes: must be a string with at most 500 characters`);
    }
  }
}

/**
 * Validates that `doc` conforms to the {@link OperatorRecord} shape and all
 * structural invariants. Returns an {@link OperatorValidationResult} - never
 * throws.
 *
 * For full JSON Schema-based validation run the record through
 * `schema/operator.schema.json` using a JSON Schema validator such as Ajv.
 */
export function validateOperatorRecord(doc: unknown): OperatorValidationResult {
  const errors: string[] = [];

  if (!isRecord(doc)) {
    return { valid: false, errors: ["root: OperatorRecord must be an object"] };
  }

  if (typeof doc["id"] !== "string" || !KEBAB_RE.test(doc["id"])) {
    errors.push("id: must be a kebab-case slug");
  }
  if (typeof doc["name"] !== "string" || doc["name"].length === 0 || doc["name"].length > 100) {
    errors.push("name: must be a non-empty string (max 100 chars)");
  }
  if (typeof doc["stellarAddress"] !== "string" || !ACCOUNT_ID_RE.test(doc["stellarAddress"])) {
    errors.push("stellarAddress: must be a G-prefixed 56-character Stellar strkey");
  }
  if (typeof doc["contact"] !== "string" || doc["contact"].length === 0) {
    errors.push("contact: must be a non-empty string");
  }
  if (typeof doc["maintainer"] !== "string" || doc["maintainer"].length === 0) {
    errors.push("maintainer: must be a non-empty string");
  }
  if (!Array.isArray(doc["supportedTriggers"]) || doc["supportedTriggers"].length === 0) {
    errors.push("supportedTriggers: must be a non-empty array");
  } else {
    for (const trigger of doc["supportedTriggers"]) {
      if (!VALID_TRIGGER_CLASSES.includes(trigger as TriggerClass)) {
        errors.push(`supportedTriggers: invalid trigger class "${String(trigger)}"`);
      }
    }
  }
  if (!Array.isArray(doc["networks"]) || doc["networks"].length === 0) {
    errors.push("networks: must be a non-empty array");
  } else {
    for (const network of doc["networks"]) {
      if (!VALID_NETWORKS.includes(network as "mainnet")) {
        errors.push(`networks: invalid network "${String(network)}"`);
      }
    }
  }
  validateOperatorTerms(doc["terms"], "terms", errors);
  if (!VALID_LATENCY_TIERS.includes(doc["latencyTier"] as LatencyTier)) {
    errors.push(`latencyTier: must be one of ${VALID_LATENCY_TIERS.join(", ")}`);
  }
  if (typeof doc["version"] !== "string" || !SEMVER_RE.test(doc["version"])) {
    errors.push("version: must be a semver string (e.g. \"1.0.0\")");
  }
  if (typeof doc["createdAt"] !== "string" || !ISO_8601_RE.test(doc["createdAt"])) {
    errors.push("createdAt: must be an ISO 8601 timestamp");
  }
  if (typeof doc["updatedAt"] !== "string" || !ISO_8601_RE.test(doc["updatedAt"])) {
    errors.push("updatedAt: must be an ISO 8601 timestamp");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Validates that `doc` conforms to the {@link WorkerOfferingRecord} shape and
 * all structural invariants. Returns a {@link WorkerOfferingValidationResult}
 * - never throws.
 *
 * For full JSON Schema-based validation run the record through
 * `schema/worker-offering.schema.json` using a JSON Schema validator such as
 * Ajv.
 */
export function validateWorkerOfferingRecord(doc: unknown): WorkerOfferingValidationResult {
  const errors: string[] = [];

  if (!isRecord(doc)) {
    return { valid: false, errors: ["root: WorkerOfferingRecord must be an object"] };
  }

  if (typeof doc["id"] !== "string" || !KEBAB_RE.test(doc["id"])) {
    errors.push("id: must be a kebab-case slug");
  }
  if (typeof doc["contractId"] !== "string" || !CONTRACT_ID_RE.test(doc["contractId"])) {
    errors.push("contractId: must be a C-prefixed 56-character Stellar strkey");
  }
  if (typeof doc["functionName"] !== "string" || doc["functionName"].length === 0) {
    errors.push("functionName: must be a non-empty string");
  }
  if (!VALID_TRIGGER_CLASSES.includes(doc["triggerClass"] as TriggerClass)) {
    errors.push(`triggerClass: must be one of ${VALID_TRIGGER_CLASSES.join(", ")}`);
  }
  validateOperatorTerms(doc["terms"], "terms", errors);
  if (typeof doc["operatorId"] !== "string" || !KEBAB_RE.test(doc["operatorId"])) {
    errors.push("operatorId: must be a kebab-case slug");
  }
  if (typeof doc["version"] !== "string" || !SEMVER_RE.test(doc["version"])) {
    errors.push("version: must be a semver string (e.g. \"1.0.0\")");
  }
  if (typeof doc["createdAt"] !== "string" || !ISO_8601_RE.test(doc["createdAt"])) {
    errors.push("createdAt: must be an ISO 8601 timestamp");
  }
  if (typeof doc["updatedAt"] !== "string" || !ISO_8601_RE.test(doc["updatedAt"])) {
    errors.push("updatedAt: must be an ISO 8601 timestamp");
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
