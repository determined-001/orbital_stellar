/**
 * Complete type system for the Orbital ABI Spec format (issue #649).
 *
 * Covers every Soroban value type, all function/event descriptors,
 * and the top-level ContractSpec envelope.
 *
 * For JSON Schema–based validation see `schema/spec.schema.json`.
 */

// ── Soroban primitive value types ────────────────────────────────────────────

/** All atomic Soroban scalar types. */
export type PrimitiveType =
  | "bool"
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "u256"
  | "i256"
  | "bytes"
  | "string"
  | "symbol"
  | "address"
  | "void";

/** Fixed-length byte array, e.g. `bytes_n<32>`. */
export type BytesNType = { readonly type: "bytes_n"; readonly size: number };

/** Soroban `Option<T>` — a value that may be present or absent. */
export type OptionType = { readonly type: "option"; readonly inner: TypeSpec };

/** Soroban `Result<T, E>` — either an `Ok` value or an `Err` value. */
export type ResultType = {
  readonly type: "result";
  readonly ok: TypeSpec;
  readonly err: TypeSpec;
};

/** Homogeneous variable-length sequence. */
export type VecType = { readonly type: "vec"; readonly item: TypeSpec };

/** Ordered key–value map. */
export type MapType = {
  readonly type: "map";
  readonly key: TypeSpec;
  readonly value: TypeSpec;
};

/** Fixed-length heterogeneous sequence (Soroban `Tuple`). Minimum 2 elements. */
export type TupleType = {
  readonly type: "tuple";
  readonly elements: ReadonlyArray<TypeSpec>;
};

/**
 * Reference to a user-defined type (struct, enum, or union) declared in
 * {@link ContractSpec.types}.
 */
export type NamedType = { readonly type: "named"; readonly name: string };

/**
 * Union of every representable Soroban type.
 * Either a {@link PrimitiveType} string literal or a tagged-object composite type.
 */
export type TypeSpec =
  PrimitiveType | BytesNType | OptionType | ResultType | VecType | MapType | TupleType | NamedType;

// ── Shared building-block ─────────────────────────────────────────────────────

/** A named, typed field used in function params, struct fields, and event data. */
export type FieldSpec = {
  readonly name: string;
  readonly type: TypeSpec;
  readonly doc?: string;
};

// ── Function and event descriptors ────────────────────────────────────────────

/**
 * Specification of one exported Soroban contract function.
 * Maps to a single `ScSpecFunctionV0` XDR entry.
 */
export type FunctionSpec = {
  readonly name: string;
  readonly doc?: string;
  readonly params: ReadonlyArray<FieldSpec>;
  /** Return type. Use `'void'` for functions that return nothing. */
  readonly returns: TypeSpec;
};

/**
 * Specification of one contract event emitted via `env.events().publish()`.
 * Topics carry discriminant ScVals; data carries the payload body.
 */
export type EventSpec = {
  /** Symbolic name of the event (matched against the first topic). */
  readonly name: string;
  readonly doc?: string;
  /**
   * Ordered topic ScVal descriptors.
   * The first topic is conventionally the event-name Symbol.
   */
  readonly topics: ReadonlyArray<FieldSpec>;
  /** Ordered payload data fields emitted alongside the topics. */
  readonly data: ReadonlyArray<FieldSpec>;
};

// ── User-defined type descriptors ─────────────────────────────────────────────

/** A named, typed field within a struct. Alias of {@link FieldSpec}. */
export type StructFieldSpec = FieldSpec;

/** Descriptor for a user-defined struct type. */
export type StructTypeSpec = {
  readonly kind: "struct";
  readonly name: string;
  readonly doc?: string;
  readonly fields: ReadonlyArray<StructFieldSpec>;
};

/** A single variant of an enum (unit or tuple style). */
export type EnumVariantSpec = {
  readonly name: string;
  readonly doc?: string;
  /** XDR discriminant value (u32). */
  readonly discriminant: number;
  /** Present for tuple-style variants that carry an associated value. */
  readonly value?: TypeSpec;
};

/** Descriptor for a user-defined enum (C-style or tuple-variant) type. */
export type EnumTypeSpec = {
  readonly kind: "enum";
  readonly name: string;
  readonly doc?: string;
  readonly variants: ReadonlyArray<EnumVariantSpec>;
};

/** A single case of a discriminated union (tagged union / Rust enum with data). */
export type UnionCaseSpec = {
  readonly name: string;
  readonly doc?: string;
  /** Fields carried by this case. Empty array for unit variants. */
  readonly fields: ReadonlyArray<FieldSpec>;
};

/** Descriptor for a user-defined discriminated union type. */
export type UnionTypeSpec = {
  readonly kind: "union";
  readonly name: string;
  readonly doc?: string;
  readonly cases: ReadonlyArray<UnionCaseSpec>;
};

/** Any user-defined type that may appear in the contract's ABI surface. */
export type UserDefinedType = StructTypeSpec | EnumTypeSpec | UnionTypeSpec;

// ── Top-level ContractSpec ────────────────────────────────────────────────────

/**
 * Canonical ABI specification for a deployed Soroban smart contract.
 *
 * Enumerates every exported function, every emitted event, and every
 * user-defined type referenced by the ABI surface.
 *
 * Serialisable to JSON and validatable against `schema/spec.schema.json`.
 */
export type ContractSpec = {
  /** Semantic version string, e.g. `"1.0.0"`. */
  readonly version: string;
  /** Human-readable contract name (1–100 characters). */
  readonly name: string;
  readonly description?: string;
  /** Bech32-encoded Soroban contract address (`C…`). */
  readonly contractId?: string;
  /** Network the spec was generated from. */
  readonly network?: "mainnet" | "testnet" | "futurenet";
  /** All exported Soroban contract functions. */
  readonly functions: ReadonlyArray<FunctionSpec>;
  /** All events emitted by the contract. */
  readonly events: ReadonlyArray<EventSpec>;
  /**
   * Named user-defined types referenced in function signatures or events.
   * Keyed by the type name that {@link NamedType} references.
   */
  readonly types: Readonly<Record<string, UserDefinedType>>;
  /** Raw XDR entries as base64 strings (if available from on-chain data). */
  readonly xdrEntries?: ReadonlyArray<string>;
};

// ── Runtime validation ────────────────────────────────────────────────────────

/** Result returned by {@link validateSpec}. */
export type ValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly errors: ReadonlyArray<string> };

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set<PrimitiveType>([
  "bool",
  "u32",
  "i32",
  "u64",
  "i64",
  "u128",
  "i128",
  "u256",
  "i256",
  "bytes",
  "string",
  "symbol",
  "address",
  "void",
]);

const COMPOSITE_TYPE_TAGS = new Set([
  "bytes_n",
  "option",
  "result",
  "vec",
  "map",
  "tuple",
  "named",
]);

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateTypeSpec(t: unknown, path: string, errors: string[]): void {
  if (typeof t === "string") {
    if (!PRIMITIVE_TYPES.has(t)) {
      errors.push(`${path}: unknown primitive type "${t}"`);
    }
    return;
  }
  if (!isRecord(t)) {
    errors.push(`${path}: TypeSpec must be a string or object`);
    return;
  }
  const tag = t["type"];
  if (typeof tag !== "string" || !COMPOSITE_TYPE_TAGS.has(tag)) {
    errors.push(
      `${path}.type: expected one of ${[...COMPOSITE_TYPE_TAGS].join(", ")}, got ${JSON.stringify(tag)}`,
    );
    return;
  }
  switch (tag) {
    case "bytes_n": {
      const size = t["size"];
      if (typeof size !== "number" || !Number.isInteger(size) || size < 1) {
        errors.push(`${path}.size: must be a positive integer`);
      }
      break;
    }
    case "option":
      validateTypeSpec(t["inner"], `${path}.inner`, errors);
      break;
    case "result":
      validateTypeSpec(t["ok"], `${path}.ok`, errors);
      validateTypeSpec(t["err"], `${path}.err`, errors);
      break;
    case "vec":
      validateTypeSpec(t["item"], `${path}.item`, errors);
      break;
    case "map":
      validateTypeSpec(t["key"], `${path}.key`, errors);
      validateTypeSpec(t["value"], `${path}.value`, errors);
      break;
    case "tuple": {
      const elems = t["elements"];
      if (!Array.isArray(elems) || elems.length < 2) {
        errors.push(`${path}.elements: tuple requires at least 2 elements`);
      } else {
        (elems as unknown[]).forEach((e, i) =>
          validateTypeSpec(e, `${path}.elements[${i}]`, errors),
        );
      }
      break;
    }
    case "named":
      if (typeof t["name"] !== "string" || t["name"].length === 0) {
        errors.push(`${path}.name: must be a non-empty string`);
      }
      break;
  }
}

function validateFieldSpec(f: unknown, path: string, errors: string[]): void {
  if (!isRecord(f)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (typeof f["name"] !== "string" || !IDENTIFIER_RE.test(f["name"])) {
    errors.push(`${path}.name: must be a valid identifier`);
  }
  validateTypeSpec(f["type"], `${path}.type`, errors);
}

function validateFunctionSpec(fn: unknown, path: string, errors: string[]): void {
  if (!isRecord(fn)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (typeof fn["name"] !== "string" || !IDENTIFIER_RE.test(fn["name"])) {
    errors.push(`${path}.name: must be a valid identifier`);
  }
  if (!Array.isArray(fn["params"])) {
    errors.push(`${path}.params: must be an array`);
  } else {
    (fn["params"] as unknown[]).forEach((p, i) =>
      validateFieldSpec(p, `${path}.params[${i}]`, errors),
    );
  }
  validateTypeSpec(fn["returns"], `${path}.returns`, errors);
}

function validateEventSpec(ev: unknown, path: string, errors: string[]): void {
  if (!isRecord(ev)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (typeof ev["name"] !== "string" || ev["name"].length === 0) {
    errors.push(`${path}.name: must be a non-empty string`);
  }
  if (!Array.isArray(ev["topics"])) {
    errors.push(`${path}.topics: must be an array`);
  } else {
    (ev["topics"] as unknown[]).forEach((t, i) =>
      validateFieldSpec(t, `${path}.topics[${i}]`, errors),
    );
  }
  if (!Array.isArray(ev["data"])) {
    errors.push(`${path}.data: must be an array`);
  } else {
    (ev["data"] as unknown[]).forEach((d, i) => validateFieldSpec(d, `${path}.data[${i}]`, errors));
  }
}

/**
 * Validates that `spec` conforms to the {@link ContractSpec} shape and all
 * structural invariants.  Returns a {@link ValidationResult} — never throws.
 *
 * For full JSON Schema–based validation run the spec through
 * `schema/spec.schema.json` using a JSON Schema validator such as Ajv.
 */
export function validateSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(spec)) {
    return { valid: false, errors: ["root: ContractSpec must be an object"] };
  }

  if (typeof spec["version"] !== "string" || !SEMVER_RE.test(spec["version"])) {
    errors.push('version: must be a semver string (e.g. "1.0.0")');
  }
  if (typeof spec["name"] !== "string" || spec["name"].length === 0 || spec["name"].length > 100) {
    errors.push("name: must be a non-empty string of at most 100 characters");
  }
  if (spec["description"] !== undefined && typeof spec["description"] !== "string") {
    errors.push("description: must be a string");
  }
  if (spec["contractId"] !== undefined) {
    if (typeof spec["contractId"] !== "string" || !CONTRACT_ID_RE.test(spec["contractId"])) {
      errors.push("contractId: must be a C-prefixed 56-character Stellar strkey");
    }
  }
  if (spec["network"] !== undefined) {
    const validNetworks = new Set(["mainnet", "testnet", "futurenet"]);
    if (!validNetworks.has(spec["network"] as string)) {
      errors.push('network: must be "mainnet", "testnet", or "futurenet"');
    }
  }
  if (!Array.isArray(spec["functions"])) {
    errors.push("functions: must be an array");
  } else {
    (spec["functions"] as unknown[]).forEach((fn, i) =>
      validateFunctionSpec(fn, `functions[${i}]`, errors),
    );
  }
  if (!Array.isArray(spec["events"])) {
    errors.push("events: must be an array");
  } else {
    (spec["events"] as unknown[]).forEach((ev, i) => validateEventSpec(ev, `events[${i}]`, errors));
  }
  if (!isRecord(spec["types"])) {
    errors.push("types: must be an object");
  }
  if (spec["xdrEntries"] !== undefined) {
    if (
      !Array.isArray(spec["xdrEntries"]) ||
      !(spec["xdrEntries"] as unknown[]).every((e) => typeof e === "string")
    ) {
      errors.push("xdrEntries: must be an array of strings");
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
