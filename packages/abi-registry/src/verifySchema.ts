/**
 * Schema verification: compare a submitted schema against the on-chain
 * contract spec and report a verdict.
 *
 * Reuses the existing discovery chain (`discoverContractSpec`, `parseContractSpec`,
 * `xdrToSpec`) to fetch and normalize the on-chain reality, then performs
 * field-by-field comparison to produce a structured mismatch report.
 */

import type { ContractSpec, TypeSpec, FieldSpec, UserDefinedType } from "./spec.js";
import { NoEmbeddedSpecError } from "./discovery/parseContractSpec.js";
import { fetchContractWasm } from "./discovery/fetchContractCode.js";
import { parseWasmSpec } from "./discovery/parseContractSpec.js";

/**
 * Represents a single field-level difference between submitted and on-chain schemas.
 */
export type SchemaFieldDiff = {
  /** Path to the field: e.g. "functions.0.params.1", "types.Token.fields.0" */
  path: string;
  /** Value from the submitted schema */
  submitted: unknown;
  /** Value from the on-chain contract spec */
  onChain: unknown;
};

/**
 * Represents a mismatch verdict when submitted schema differs from on-chain.
 */
export type SchemaMismatch = {
  status: "mismatch";
  /** Array of specific field-level differences */
  diffs: SchemaFieldDiff[];
};

/**
 * Represents a match verdict when submitted schema matches on-chain spec.
 */
export type SchemaMatch = {
  status: "match";
};

/**
 * Represents an unverifiable verdict when the contract has no embedded spec
 * (pre-SEP-48 contract or non-WASM contract like SAC).
 */
export type SchemaUnverifiable = {
  status: "unverifiable";
  /** Reason why verification could not be performed */
  reason: string;
};

/**
 * Verdict from schema verification: match, mismatch (with field-level diffs),
 * or unverifiable (no embedded spec).
 */
export type SchemaVerdict = SchemaMatch | SchemaMismatch | SchemaUnverifiable;

/**
 * Options for schema verification.
 */
export type VerifySchemaOptions = {
  /** RPC endpoint URL to query the contract from */
  rpcUrl: string;
  /** Network name for context (optional, passed to discovery) */
  network?: "mainnet" | "testnet" | "futurenet";
};

/**
 * Recursively compares two TypeSpec values for equality.
 * Handles primitives, composite types, and named type references.
 */
function compareTypeSpecs(submitted: TypeSpec, onChain: TypeSpec): boolean {
  // Handle string primitives
  if (typeof submitted === "string" && typeof onChain === "string") {
    return submitted === onChain;
  }

  // Both must be objects at this point
  if (typeof submitted !== "object" || typeof onChain !== "object") {
    return false;
  }

  // Check for type tag mismatch
  if (
    ("type" in submitted && "type" in onChain && submitted.type !== onChain.type) ||
    "type" in submitted !== "type" in onChain
  ) {
    return false;
  }

  // Handle bytes_n
  if ("type" in submitted && submitted.type === "bytes_n") {
    return (
      "type" in onChain &&
      onChain.type === "bytes_n" &&
      "size" in submitted &&
      "size" in onChain &&
      (submitted.size as number) === (onChain.size as number)
    );
  }

  // Handle option
  if ("type" in submitted && submitted.type === "option") {
    return (
      "type" in onChain &&
      onChain.type === "option" &&
      "inner" in submitted &&
      "inner" in onChain &&
      compareTypeSpecs(submitted.inner as TypeSpec, onChain.inner as TypeSpec)
    );
  }

  // Handle result
  if ("type" in submitted && submitted.type === "result") {
    return (
      "type" in onChain &&
      onChain.type === "result" &&
      "ok" in submitted &&
      "ok" in onChain &&
      "err" in submitted &&
      "err" in onChain &&
      compareTypeSpecs(submitted.ok as TypeSpec, onChain.ok as TypeSpec) &&
      compareTypeSpecs(submitted.err as TypeSpec, onChain.err as TypeSpec)
    );
  }

  // Handle vec
  if ("type" in submitted && submitted.type === "vec") {
    return (
      "type" in onChain &&
      onChain.type === "vec" &&
      "item" in submitted &&
      "item" in onChain &&
      compareTypeSpecs(submitted.item as TypeSpec, onChain.item as TypeSpec)
    );
  }

  // Handle map
  if ("type" in submitted && submitted.type === "map") {
    return (
      "type" in onChain &&
      onChain.type === "map" &&
      "key" in submitted &&
      "key" in onChain &&
      "value" in submitted &&
      "value" in onChain &&
      compareTypeSpecs(submitted.key as TypeSpec, onChain.key as TypeSpec) &&
      compareTypeSpecs(submitted.value as TypeSpec, onChain.value as TypeSpec)
    );
  }

  // Handle tuple
  if ("type" in submitted && submitted.type === "tuple") {
    return (
      "type" in onChain &&
      onChain.type === "tuple" &&
      "elements" in submitted &&
      "elements" in onChain &&
      Array.isArray(submitted.elements) &&
      Array.isArray(onChain.elements) &&
      submitted.elements.length === onChain.elements.length &&
      submitted.elements.every((elem, i) =>
        compareTypeSpecs(elem as TypeSpec, (onChain.elements as TypeSpec[])[i]!),
      )
    );
  }

  // Handle named type
  if ("type" in submitted && submitted.type === "named") {
    return (
      "type" in onChain &&
      onChain.type === "named" &&
      "name" in submitted &&
      "name" in onChain &&
      (submitted.name as string) === (onChain.name as string)
    );
  }

  return false;
}

/**
 * Recursively compares two FieldSpec arrays for equality.
 */
function compareFieldSpecs(
  submitted: readonly FieldSpec[],
  onChain: readonly FieldSpec[],
): boolean {
  if (submitted.length !== onChain.length) {
    return false;
  }
  return submitted.every((submittedField, i) => {
    const onChainField = onChain[i];
    if (!onChainField) return false;
    return (
      submittedField.name === onChainField.name &&
      compareTypeSpecs(submittedField.type, onChainField.type)
    );
  });
}

/**
 * Compares two UserDefinedType values for equality.
 * Recursively compares struct fields, enum variants, or union cases.
 */
function compareUserDefinedTypes(submitted: UserDefinedType, onChain: UserDefinedType): boolean {
  if (submitted.kind !== onChain.kind) {
    return false;
  }
  if (submitted.name !== onChain.name) {
    return false;
  }

  if (submitted.kind === "struct" && onChain.kind === "struct") {
    return compareFieldSpecs(submitted.fields, onChain.fields);
  }

  if (submitted.kind === "enum" && onChain.kind === "enum") {
    if (submitted.variants.length !== onChain.variants.length) {
      return false;
    }
    return submitted.variants.every((submittedVariant, i) => {
      const onChainVariant = onChain.variants[i];
      if (!onChainVariant) return false;
      return (
        submittedVariant.name === onChainVariant.name &&
        submittedVariant.discriminant === onChainVariant.discriminant &&
        ((submittedVariant.value === undefined && onChainVariant.value === undefined) ||
          (submittedVariant.value !== undefined &&
            onChainVariant.value !== undefined &&
            compareTypeSpecs(submittedVariant.value, onChainVariant.value)))
      );
    });
  }

  if (submitted.kind === "union" && onChain.kind === "union") {
    if (submitted.cases.length !== onChain.cases.length) {
      return false;
    }
    return submitted.cases.every((submittedCase, i) => {
      const onChainCase = onChain.cases[i];
      if (!onChainCase) return false;
      return (
        submittedCase.name === onChainCase.name &&
        compareFieldSpecs(submittedCase.fields, onChainCase.fields)
      );
    });
  }

  return false;
}

/**
 * Collects field-level differences between two specs.
 * Recursively walks both specs in parallel and records paths where they differ.
 */
function collectDiffs(
  submitted: ContractSpec,
  onChain: ContractSpec,
  basePath = "",
): SchemaFieldDiff[] {
  const diffs: SchemaFieldDiff[] = [];

  // Compare functions
  if (submitted.functions.length !== onChain.functions.length) {
    diffs.push({
      path: `${basePath}functions.length`,
      submitted: submitted.functions.length,
      onChain: onChain.functions.length,
    });
  }

  // Compare functions by name -> index mapping
  const submittedFunctionsByName = new Map(submitted.functions.map((f) => [f.name, f]));
  const onChainFunctionsByName = new Map(onChain.functions.map((f) => [f.name, f]));

  // Check for functions in submitted that aren't in onChain
  for (const name of submittedFunctionsByName.keys()) {
    if (!onChainFunctionsByName.has(name)) {
      diffs.push({
        path: `functions[${name}]`,
        submitted: name,
        onChain: undefined,
      });
    }
  }

  // Check for functions in onChain that aren't in submitted
  for (const name of onChainFunctionsByName.keys()) {
    if (!submittedFunctionsByName.has(name)) {
      diffs.push({
        path: `functions[${name}]`,
        submitted: undefined,
        onChain: name,
      });
    }
  }

  // Compare common functions
  for (const name of submittedFunctionsByName.keys()) {
    if (!onChainFunctionsByName.has(name)) continue;

    const submittedFn = submittedFunctionsByName.get(name)!;
    const onChainFn = onChainFunctionsByName.get(name)!;
    const fnPath = `functions[${name}]`;

    if (!compareFieldSpecs(submittedFn.params, onChainFn.params)) {
      diffs.push({
        path: `${fnPath}.params`,
        submitted: submittedFn.params,
        onChain: onChainFn.params,
      });
    }

    if (!compareTypeSpecs(submittedFn.returns, onChainFn.returns)) {
      diffs.push({
        path: `${fnPath}.returns`,
        submitted: submittedFn.returns,
        onChain: onChainFn.returns,
      });
    }
  }

  // Compare events
  if (submitted.events.length !== onChain.events.length) {
    diffs.push({
      path: `${basePath}events.length`,
      submitted: submitted.events.length,
      onChain: onChain.events.length,
    });
  }

  const submittedEventsByName = new Map(submitted.events.map((e) => [e.name, e]));
  const onChainEventsByName = new Map(onChain.events.map((e) => [e.name, e]));

  // Check for events in submitted that aren't in onChain
  for (const name of submittedEventsByName.keys()) {
    if (!onChainEventsByName.has(name)) {
      diffs.push({
        path: `events[${name}]`,
        submitted: name,
        onChain: undefined,
      });
    }
  }

  // Check for events in onChain that aren't in submitted
  for (const name of onChainEventsByName.keys()) {
    if (!submittedEventsByName.has(name)) {
      diffs.push({
        path: `events[${name}]`,
        submitted: undefined,
        onChain: name,
      });
    }
  }

  // Compare common events
  for (const name of submittedEventsByName.keys()) {
    if (!onChainEventsByName.has(name)) continue;

    const submittedEvent = submittedEventsByName.get(name)!;
    const onChainEvent = onChainEventsByName.get(name)!;
    const eventPath = `events[${name}]`;

    if (!compareFieldSpecs(submittedEvent.topics, onChainEvent.topics)) {
      diffs.push({
        path: `${eventPath}.topics`,
        submitted: submittedEvent.topics,
        onChain: onChainEvent.topics,
      });
    }

    if (!compareFieldSpecs(submittedEvent.data, onChainEvent.data)) {
      diffs.push({
        path: `${eventPath}.data`,
        submitted: submittedEvent.data,
        onChain: onChainEvent.data,
      });
    }
  }

  // Compare types
  const submittedTypeNames = Object.keys(submitted.types);
  const onChainTypeNames = Object.keys(onChain.types);

  // Check for types in submitted that aren't in onChain
  for (const name of submittedTypeNames) {
    if (!onChain.types[name]) {
      diffs.push({
        path: `types[${name}]`,
        submitted: name,
        onChain: undefined,
      });
    }
  }

  // Check for types in onChain that aren't in submitted
  for (const name of onChainTypeNames) {
    if (!submitted.types[name]) {
      diffs.push({
        path: `types[${name}]`,
        submitted: undefined,
        onChain: name,
      });
    }
  }

  // Compare common types
  for (const name of submittedTypeNames) {
    if (!onChain.types[name]) continue;

    const submittedType = submitted.types[name]!;
    const onChainType = onChain.types[name]!;

    if (!compareUserDefinedTypes(submittedType, onChainType)) {
      diffs.push({
        path: `types[${name}]`,
        submitted: submittedType,
        onChain: onChainType,
      });
    }
  }

  return diffs;
}

/**
 * Failure shapes from `fetchContractWasm` that mean "this contract has no WASM
 * to fetch", not "the RPC call went wrong":
 *
 * - `not found` - no such contract, or no `ContractCode` entry for it.
 * - `Cannot destructure property 'length'` - a Stellar Asset Contract. SACs
 *   (USDC/EURC/AQUA/the native XLM wrapper - exactly the bundled well-known
 *   specs) use `ContractExecutable::StellarAsset`, so there is no code entry,
 *   and the SDK throws from deep inside XDR deserialization rather than raising
 *   a typed "not a WASM contract" error. {@link discoverContractSpec} documents
 *   the same SDK behaviour and treats any WASM-fetch failure as "nothing to
 *   discover" for this reason.
 *
 * Anything else - connection refused, HTTP 5xx, timeouts - propagates, so a
 * broken RPC endpoint is never silently reported as `unverifiable`.
 */
const NO_WASM_ERROR_PATTERNS: readonly RegExp[] = [
  /not found/i,
  /Cannot destructure property 'length'/i,
];

function isNoWasmFailure(error: Error): boolean {
  return NO_WASM_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * Verifies a submitted schema against the on-chain contract spec.
 *
 * Fetches the contract's embedded spec (if available), normalizes it to the
 * canonical ContractSpec format, and compares it field-by-field against the
 * submitted schema.
 *
 * @param contractId Bech32-encoded Soroban contract address (C…)
 * @param submittedSchema The schema being verified
 * @param options Configuration including RPC endpoint and network
 * @returns A verdict: `match` | `mismatch` (with diffs) | `unverifiable` (no embedded spec)
 *
 * @example
 * ```ts
 * const verdict = await verifySchema(
 *   "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
 *   submittedSchema,
 *   { rpcUrl: "https://soroban-testnet.stellar.org", network: "testnet" }
 * );
 *
 * if (verdict.status === "match") {
 *   console.log("✓ Schema matches on-chain contract spec");
 * } else if (verdict.status === "mismatch") {
 *   console.log("✗ Schema mismatches:", verdict.diffs);
 * } else {
 *   console.log("? Cannot verify:", verdict.reason);
 * }
 * ```
 */
export async function verifySchema(
  contractId: string,
  submittedSchema: ContractSpec,
  options: VerifySchemaOptions,
): Promise<SchemaVerdict> {
  // Fetch WASM bytecode via RPC
  // If the fetch fails, re-throw so callers can handle RPC errors appropriately
  let wasm: Buffer;
  try {
    wasm = await fetchContractWasm(options.rpcUrl, contractId);
  } catch (error) {
    // Distinguish between genuine RPC errors and "there is no WASM to fetch"
    // scenarios, which are unverifiable rather than failures.
    if (error instanceof Error && isNoWasmFailure(error)) {
      return {
        status: "unverifiable",
        reason: "Contract has no embedded contractspec (pre-SEP-48 or non-WASM contract)",
      };
    }
    // Re-throw genuine RPC/network errors
    throw error;
  }

  // Parse the WASM to extract the embedded spec
  let onChainSpec: ContractSpec;
  try {
    const parsed = parseWasmSpec(wasm);
    onChainSpec = {
      version: "0.0.0",
      name: contractId,
      contractId,
      ...(options.network ? { network: options.network } : {}),
      functions: parsed.functions,
      events: parsed.events,
      types: parsed.types,
      xdrEntries: parsed.xdrEntries,
    };
  } catch (error) {
    if (error instanceof NoEmbeddedSpecError) {
      return {
        status: "unverifiable",
        reason: "Contract has no embedded contractspec (pre-SEP-48 or non-WASM contract)",
      };
    }
    // Re-throw other errors from parsing (shouldn't happen in normal cases)
    throw error;
  }

  // Compare the specs
  const diffs = collectDiffs(submittedSchema, onChainSpec);

  if (diffs.length === 0) {
    return { status: "match" };
  }

  return {
    status: "mismatch",
    diffs,
  };
}
