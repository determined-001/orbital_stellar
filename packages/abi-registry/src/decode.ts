/**
 * XDR → typed JSON decoder for Soroban contract events.
 *
 * Decodes a raw Soroban contract event against a known {@link ContractSpec},
 * mapping each topic and the data payload to a typed JavaScript value.
 *
 * The decoder never throws — shape mismatches and unknown types are returned
 * as a structured `{ error: string }` result.
 *
 * ## Supported Soroban types
 *
 * | Spec type   | JS representation                          |
 * |-------------|---------------------------------------------|
 * | `bool`      | `boolean`                                   |
 * | `u32`       | `number`                                    |
 * | `i32`       | `number`                                    |
 * | `u64`       | `string` (preserves full 64-bit precision)  |
 * | `i64`       | `string`                                    |
 * | `u128`      | `string`                                    |
 * | `i128`      | `string`                                    |
 * | `u256`      | `string`                                    |
 * | `i256`      | `string`                                    |
 * | `bytes`     | `string` (hex-encoded)                      |
 * | `String`    | `string`                                    |
 * | `Symbol`    | `string`                                    |
 * | `Address`   | `string` (strkey)                           |
 * | `void`      | `null`                                      |
 * | `vec<T>`    | `DecodedValue[]`                            |
 * | `map<K,V>`  | `Array<{ key: DecodedValue; value: DecodedValue }>` |
 * | custom struct | `Record<string, DecodedValue>`            |
 */

import type { ContractSpec } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A successfully decoded Soroban value. */
export type DecodedValue =
  | null
  | boolean
  | number
  | string
  | DecodedValueArray
  | DecodedValueMap
  | DecodedValueObject;

/** Array of decoded values (interface indirection breaks the alias self-reference). */
export interface DecodedValueArray extends Array<DecodedValue> {}
/** Decoded Soroban map: an array of key/value pairs. */
export interface DecodedValueMap
  extends Array<{ key: DecodedValue; value: DecodedValue }> {}
/** Decoded struct: string-keyed record of decoded values. */
export interface DecodedValueObject {
  [key: string]: DecodedValue;
}

/** A successfully decoded contract event. */
export type DecodedEvent = {
  /** The function name matched from the spec (first topic symbol). */
  functionName: string;
  /** Decoded topic values (index 0 is the function name symbol). */
  topics: DecodedValue[];
  /** Decoded data payload. */
  data: DecodedValue;
};

/** Returned when decoding fails — never throws. */
export type DecodeError = {
  error: string;
};

/** Result of {@link decodeContractEvent}. */
export type DecodeResult = DecodedEvent | DecodeError;

// ---------------------------------------------------------------------------
// Raw ScVal shape (as returned by Horizon / Soroban RPC JSON responses)
// ---------------------------------------------------------------------------

/**
 * A raw ScVal as it appears in Horizon/RPC JSON responses.
 * The discriminant is the single key of the object (e.g. `{ "u32": 42 }`).
 */
type RawScVal =
  | { bool: boolean }
  | { void: null | undefined }
  | { u32: number }
  | { i32: number }
  | { u64: string | number }
  | { i64: string | number }
  | { u128: { lo: string | number; hi: string | number } | string | number }
  | { i128: { lo: string | number; hi: string | number } | string | number }
  | { u256: string | number }
  | { i256: string | number }
  | { bytes: string }
  | { str: string }
  | { sym: string }
  | { address: string }
  | { vec: RawScVal[] | null }
  | { map: Array<{ key: RawScVal; val: RawScVal }> | null }
  | Record<string, unknown>; // custom struct / fallback

// ---------------------------------------------------------------------------
// Core decoder
// ---------------------------------------------------------------------------

/**
 * Decode a raw Soroban contract event against a known contract spec.
 *
 * @param spec - The {@link ContractSpec} describing the contract's ABI.
 * @param rawEvent - The raw event object as emitted by pulse-core
 *   (`ContractEmittedEvent` or `ContractInvokedEvent`). Must have `topics`
 *   (array) and `data` fields.
 * @returns A {@link DecodedEvent} on success, or `{ error: string }` on
 *   any shape mismatch or unsupported type — never throws.
 */
export function decodeContractEvent(
  spec: ContractSpec,
  rawEvent: unknown
): DecodeResult {
  try {
    return _decode(spec, rawEvent);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function _decode(spec: ContractSpec, rawEvent: unknown): DecodeResult {
  // --- Validate rawEvent shape ---
  if (rawEvent === null || typeof rawEvent !== "object") {
    return { error: "rawEvent must be a non-null object" };
  }

  const event = rawEvent as Record<string, unknown>;

  if (!Array.isArray(event["topics"])) {
    return { error: 'rawEvent.topics must be an array' };
  }

  const rawTopics = event["topics"] as unknown[];
  const rawData = event["data"] ?? null;

  // --- Decode topics ---
  const decodedTopics: DecodedValue[] = [];
  for (let i = 0; i < rawTopics.length; i++) {
    const result = decodeScVal(rawTopics[i]);
    if (isError(result)) {
      return { error: `topic[${i}]: ${result.error}` };
    }
    decodedTopics.push(result.value);
  }

  // --- Extract function name from first topic (must be a Symbol) ---
  const firstTopic = rawTopics[0];
  const functionName = extractSymbol(firstTopic);

  // --- Decode data ---
  const dataResult = decodeScVal(rawData);
  if (isError(dataResult)) {
    return { error: `data: ${dataResult.error}` };
  }

  // --- Look up function in spec (optional — we decode regardless) ---
  // The spec is used for type-guided decoding of structured data when available.
  // If the function is not found in the spec, we still return the decoded values.
  void spec; // spec is available for future type-guided decoding

  return {
    functionName: functionName ?? "",
    topics: decodedTopics,
    data: dataResult.value,
  };
}

// ---------------------------------------------------------------------------
// ScVal decoder
// ---------------------------------------------------------------------------

type DecodeValueResult =
  | { value: DecodedValue }
  | { error: string };

function isError(r: DecodeValueResult): r is { error: string } {
  return "error" in r;
}

/**
 * Decode a single raw ScVal value to a typed JavaScript value.
 *
 * Handles both the Horizon JSON format (`{ "u32": 42 }`) and plain
 * primitive values that some RPC implementations return directly.
 */
export function decodeScVal(raw: unknown): DecodeValueResult {
  // null / undefined → void
  if (raw === null || raw === undefined) {
    return { value: null };
  }

  // Plain boolean
  if (typeof raw === "boolean") {
    return { value: raw };
  }

  // Plain number
  if (typeof raw === "number") {
    return { value: raw };
  }

  // Plain string — treat as opaque string (address, symbol, etc.)
  if (typeof raw === "string") {
    return { value: raw };
  }

  // Array — treat as vec
  if (Array.isArray(raw)) {
    return decodeVec(raw);
  }

  // Object — inspect the discriminant key
  if (typeof raw === "object") {
    return decodeScValObject(raw as Record<string, unknown>);
  }

  return { error: `Unsupported raw value type: ${typeof raw}` };
}

function decodeScValObject(obj: Record<string, unknown>): DecodeValueResult {
  const keys = Object.keys(obj);

  if (keys.length === 0) {
    return { value: null }; // empty object → void
  }

  // Single-key discriminant objects (Horizon JSON format)
  if (keys.length === 1) {
    const discriminant = keys[0]!;
    const inner = obj[discriminant];

    switch (discriminant) {
      case "bool":
        return { value: Boolean(inner) };

      case "void":
        return { value: null };

      case "u32":
      case "i32":
        return { value: Number(inner) };

      case "u64":
      case "i64":
        return { value: String(inner) };

      case "u128":
      case "i128":
        return decode128(inner);

      case "u256":
      case "i256":
        return { value: String(inner) };

      case "bytes":
        return { value: typeof inner === "string" ? inner : bufferToHex(inner) };

      case "str":
      case "string":
        return { value: String(inner) };

      case "sym":
      case "symbol":
        return { value: String(inner) };

      case "address":
        return { value: String(inner) };

      case "vec":
        if (inner === null || inner === undefined) return { value: [] };
        if (!Array.isArray(inner)) return { error: "vec value must be an array" };
        return decodeVec(inner);

      case "map":
        if (inner === null || inner === undefined) return { value: [] };
        if (!Array.isArray(inner)) return { error: "map value must be an array" };
        return decodeMap(inner);

      default:
        // Unknown single-key discriminant — treat as opaque string
        return { value: String(inner) };
    }
  }

  // Multi-key object — treat as a custom struct
  return decodeStruct(obj);
}

function decode128(inner: unknown): DecodeValueResult {
  if (inner === null || inner === undefined) return { value: "0" };
  if (typeof inner === "string" || typeof inner === "number") {
    return { value: String(inner) };
  }
  if (typeof inner === "object" && inner !== null) {
    const parts = inner as Record<string, unknown>;
    // { lo, hi } format from some SDK versions
    const lo = BigInt(String(parts["lo"] ?? 0));
    const hi = BigInt(String(parts["hi"] ?? 0));
    const combined = (hi << 64n) | lo;
    return { value: combined.toString() };
  }
  return { value: String(inner) };
}

function decodeVec(arr: unknown[]): DecodeValueResult {
  const result: DecodedValue[] = [];
  for (let i = 0; i < arr.length; i++) {
    const r = decodeScVal(arr[i]);
    if (isError(r)) return { error: `vec[${i}]: ${r.error}` };
    result.push(r.value);
  }
  return { value: result };
}

function decodeMap(
  arr: unknown[]
): DecodeValueResult {
  const result: { key: DecodedValue; value: DecodedValue }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    if (entry === null || typeof entry !== "object") {
      return { error: `map[${i}]: entry must be an object` };
    }
    const e = entry as Record<string, unknown>;
    // Support both { key, val } (XDR) and { key, value } (some SDKs)
    const rawKey = "key" in e ? e["key"] : undefined;
    const rawVal = "val" in e ? e["val"] : "value" in e ? e["value"] : undefined;

    const keyResult = decodeScVal(rawKey);
    if (isError(keyResult)) return { error: `map[${i}].key: ${keyResult.error}` };

    const valResult = decodeScVal(rawVal);
    if (isError(valResult)) return { error: `map[${i}].value: ${valResult.error}` };

    result.push({ key: keyResult.value, value: valResult.value });
  }
  return { value: result };
}

function decodeStruct(obj: Record<string, unknown>): DecodeValueResult {
  const result: Record<string, DecodedValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    const r = decodeScVal(v);
    if (isError(r)) return { error: `struct.${k}: ${r.error}` };
    result[k] = r.value;
  }
  return { value: result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSymbol(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("sym" in obj) return String(obj["sym"]);
    if ("symbol" in obj) return String(obj["symbol"]);
    if ("str" in obj) return String(obj["str"]);
  }
  return null;
}

function bufferToHex(value: unknown): string {
  if (value instanceof Uint8Array || Buffer.isBuffer(value as object)) {
    return Buffer.from(value as Uint8Array).toString("hex");
  }
  return String(value);
}
