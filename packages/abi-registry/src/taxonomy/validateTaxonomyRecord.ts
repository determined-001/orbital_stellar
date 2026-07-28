/**
 * Runtime structural validation mirroring `schema/taxonomy.schema.json`.
 * Matches this package's existing convention (see `spec.ts`'s `validateSpec`)
 * of hand-written TypeScript validation rather than a runtime `ajv` dependency
 * - `ajv` stays a devDependency, used only for the well-known-specs dev
 * script (`validate.js`), not pulled into the published runtime bundle.
 */
import type { TaxonomyMapping, TaxonomyRecord, TaxonomyScope } from "./types.js";
import { InvalidTaxonomyRecordError } from "./errors.js";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SEMANTIC_NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export type TaxonomyValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateScope(scope: unknown, path: string, errors: string[]): void {
  if (!isRecord(scope)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  const keys = ["contractId", "specHash", "interfaceId"].filter((k) => k in scope);
  if (keys.length !== 1) {
    errors.push(
      `${path}: must have exactly one of "contractId", "specHash", "interfaceId" - got [${keys.join(", ")}]`,
    );
    return;
  }
  const key = keys[0]!;
  const value = scope[key];
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path}.${key}: must be a non-empty string`);
  }
}

function validateMapping(mapping: unknown, path: string, errors: string[]): void {
  if (!isRecord(mapping)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (mapping["scope"] === undefined) {
    errors.push(`${path}.scope: required`);
  } else {
    validateScope(mapping["scope"], `${path}.scope`, errors);
  }
  if (typeof mapping["eventTopic"] !== "string" || mapping["eventTopic"].length === 0) {
    errors.push(`${path}.eventTopic: must be a non-empty string`);
  }
  const semantic = mapping["semantic"];
  if (typeof semantic !== "string" || !SEMANTIC_NAME_RE.test(semantic)) {
    errors.push(
      `${path}.semantic: must be dot-separated lowercase segments like "swap.executed", got ${JSON.stringify(semantic)}`,
    );
  }
  if (mapping["doc"] !== undefined && typeof mapping["doc"] !== "string") {
    errors.push(`${path}.doc: must be a string`);
  }
}

/** Validates a candidate document against `taxonomy.schema.json`'s constraints. */
export function validateTaxonomyRecord(doc: unknown): TaxonomyValidationResult {
  const errors: string[] = [];

  if (!isRecord(doc)) {
    return { valid: false, errors: ["taxonomy record must be an object"] };
  }
  if (typeof doc["version"] !== "string" || !VERSION_RE.test(doc["version"])) {
    errors.push(`version: must match ^\\d+\\.\\d+\\.\\d+$, got ${JSON.stringify(doc["version"])}`);
  }
  if (!Array.isArray(doc["mappings"])) {
    errors.push("mappings: must be an array");
  } else {
    doc["mappings"].forEach((m, i) => validateMapping(m, `mappings[${i}]`, errors));
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Validates and narrows in one step; throws `InvalidTaxonomyRecordError` on failure. */
export function parseTaxonomyRecord(doc: unknown): TaxonomyRecord {
  const result = validateTaxonomyRecord(doc);
  if (!result.valid) {
    throw new InvalidTaxonomyRecordError(result.errors);
  }
  return doc as TaxonomyRecord;
}

export type { TaxonomyMapping, TaxonomyRecord, TaxonomyScope };
