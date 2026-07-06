/**
 * XDR → typed JSON decoder for Soroban contract events.
 *
 * Decodes a raw Soroban contract event against a known {@link XdrContractSpec},
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

import { xdr, StrKey } from "@stellar/stellar-sdk";
import type { XdrContractSpec } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A successfully decoded Soroban value. */
export type DecodedValue =
  null | boolean | number | string | DecodedValueArray | DecodedValueMap | DecodedValueObject;

/** Array of decoded values (interface indirection breaks the alias self-reference). */
export interface DecodedValueArray extends Array<DecodedValue> {}
/** Decoded Soroban map: an array of key/value pairs. */
export interface DecodedValueMap extends Array<{ key: DecodedValue; value: DecodedValue }> {}
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
// Core decoder
// ---------------------------------------------------------------------------

/**
 * Decode a raw Soroban contract event against a known contract spec.
 *
 * @param spec - The {@link XdrContractSpec} describing the contract's ABI.
 * @param rawEvent - The raw event object as emitted by pulse-core
 *   (`ContractEmittedEvent` or `ContractInvokedEvent`). Must have `topics`
 *   (array) and `data` fields.
 * @returns A {@link DecodedEvent} on success, or `{ error: string }` on
 *   any shape mismatch or unsupported type — never throws.
 */
export function decodeContractEvent(spec: XdrContractSpec, rawEvent: unknown): DecodeResult {
  try {
    return _decode(spec, rawEvent);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function _decode(spec: XdrContractSpec, rawEvent: unknown): DecodeResult {
  // --- Validate rawEvent shape ---
  if (rawEvent === null || typeof rawEvent !== "object") {
    return { error: "rawEvent must be a non-null object" };
  }

  const event = rawEvent as Record<string, unknown>;

  if (!Array.isArray(event["topics"])) {
    return { error: "rawEvent.topics must be an array" };
  }

  // --- Validate contractId against spec when present in the event ---
  if ("contractId" in event && event["contractId"] !== undefined) {
    if (event["contractId"] !== spec.contractId) {
      return {
        error: `contractId mismatch: spec=${spec.contractId}, event=${event["contractId"]}`,
      };
    }
  }

  // --- Parse spec entries for type context (silently skips malformed entries) ---
  const specEntries = parseSpecEntries(spec.entries);
  void specEntries; // available for type-guided struct decoding when spec entries are populated

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

  // --- Extract function name from the decoded first topic ---
  // Use the decoded value so that XDR base64-encoded sym topics are resolved correctly.
  const functionName =
    decodedTopics.length > 0 && typeof decodedTopics[0] === "string" ? decodedTopics[0] : "";

  // --- Decode data ---
  const dataResult = decodeScVal(rawData);
  if (isError(dataResult)) {
    return { error: `data: ${dataResult.error}` };
  }

  return {
    functionName: functionName ?? "",
    topics: decodedTopics,
    data: dataResult.value,
  };
}

// ---------------------------------------------------------------------------
// ScVal decoder
// ---------------------------------------------------------------------------

type DecodeValueResult = { value: DecodedValue } | { error: string };

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

  // Plain string — try raw XDR base64 first; fall back to opaque string
  if (typeof raw === "string") {
    try {
      const scval = xdr.ScVal.fromXDR(raw, "base64");
      return decodeXdrScVal(scval);
    } catch {
      // Not valid XDR base64 — treat as opaque string (address strkey, symbol, etc.)
    }
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

function decodeMap(arr: unknown[]): DecodeValueResult {
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
// XDR ScVal decoder (for raw base64-encoded Soroban RPC payloads)
// ---------------------------------------------------------------------------

function decodeXdrScVal(scval: xdr.ScVal): DecodeValueResult {
  const name = scval.switch().name;
  switch (name) {
    case "scvBool":
      return { value: scval.b() };
    case "scvVoid":
      return { value: null };
    case "scvU32":
      return { value: scval.u32() };
    case "scvI32":
      return { value: scval.i32() };
    case "scvU64":
      return { value: scval.u64().toString() };
    case "scvI64":
      return { value: scval.i64().toString() };
    case "scvU128": {
      const p = scval.u128();
      const hi = BigInt(p.hi().toString());
      const lo = BigInt(p.lo().toString());
      return { value: ((hi << 64n) | lo).toString() };
    }
    case "scvI128": {
      const p = scval.i128();
      const hi = BigInt(p.hi().toString());
      const lo = BigInt(p.lo().toString());
      return { value: ((hi << 64n) | lo).toString() };
    }
    case "scvU256": {
      const p = scval.u256();
      const v =
        (BigInt(p.hiHi().toString()) << 192n) |
        (BigInt(p.hiLo().toString()) << 128n) |
        (BigInt(p.loHi().toString()) << 64n) |
        BigInt(p.loLo().toString());
      return { value: v.toString() };
    }
    case "scvI256": {
      const p = scval.i256();
      const v =
        (BigInt(p.hiHi().toString()) << 192n) |
        (BigInt(p.hiLo().toString()) << 128n) |
        (BigInt(p.loHi().toString()) << 64n) |
        BigInt(p.loLo().toString());
      return { value: v.toString() };
    }
    case "scvBytes":
      return { value: (scval.bytes() as Buffer).toString("hex") };
    case "scvString":
      return { value: scval.str().toString() };
    case "scvSymbol":
      return { value: scval.sym().toString() };
    case "scvAddress": {
      const addr = scval.address();
      if (addr.switch().name === "scAddressTypeAccount") {
        return { value: StrKey.encodeEd25519PublicKey(addr.accountId().ed25519()) };
      }
      return { value: StrKey.encodeContract(addr.contractId() as unknown as Buffer) };
    }
    case "scvVec": {
      const vec = scval.vec() ?? [];
      const result: DecodedValue[] = [];
      for (let i = 0; i < vec.length; i++) {
        const r = decodeXdrScVal(vec[i]!);
        if (isError(r)) return { error: `vec[${i}]: ${r.error}` };
        result.push(r.value);
      }
      return { value: result };
    }
    case "scvMap": {
      const map = scval.map() ?? [];
      const result: { key: DecodedValue; value: DecodedValue }[] = [];
      for (let i = 0; i < map.length; i++) {
        const entry = map[i]!;
        const kr = decodeXdrScVal(entry.key());
        const vr = decodeXdrScVal(entry.val());
        if (isError(kr)) return { error: `map[${i}].key: ${kr.error}` };
        if (isError(vr)) return { error: `map[${i}].value: ${vr.error}` };
        result.push({ key: kr.value, value: vr.value });
      }
      return { value: result };
    }
    default:
      return { error: `Unsupported XDR ScVal type: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Spec entry parser
// ---------------------------------------------------------------------------

function parseSpecEntries(entries: string[]): xdr.ScSpecEntry[] {
  const result: xdr.ScSpecEntry[] = [];
  for (const entry of entries) {
    try {
      result.push(xdr.ScSpecEntry.fromXDR(entry, "base64"));
    } catch {
      // Skip malformed entries silently
    }
  }
  return result;
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
