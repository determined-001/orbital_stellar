/**
 * spec.ts — Rich typed shape for Soroban contract ABI specs.
 *
 * Covers every primitive and composite Soroban XDR type, plus the full
 * function and event surface of a contract. Designed to be serialisable
 * to/from JSON and validatable against schema/spec.schema.json.
 */

// ---------------------------------------------------------------------------
// Primitive Soroban XDR types
// ---------------------------------------------------------------------------

/**
 * All primitive Soroban value types as string literals.
 * Matches the type names used in the Stellar SDK's ScVal / XDR layer.
 */
export type PrimitiveSorobanType =
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
  | "bytes_n"   // fixed-length byte array; length carried in TypeSpec.len
  | "string"
  | "symbol"
  | "address"
  | "void";

// ---------------------------------------------------------------------------
// Composite / container types
// ---------------------------------------------------------------------------

/**
 * A fully-resolved Soroban type, including composite and user-defined forms.
 *
 * @example Primitive:   { type: "i128" }
 * @example Option:      { type: "option", inner: { type: "address" } }
 * @example Vec:         { type: "vec",    item:  { type: "u64" } }
 * @example Map:         { type: "map",    key:   { type: "string" }, value: { type: "i128" } }
 * @example Tuple:       { type: "tuple",  fields: [{ type: "address" }, { type: "u32" }] }
 * @example Struct:      { type: "struct", name: "Transfer", fields: [{ name: "from", type: { type: "address" } }] }
 * @example Enum:        { type: "enum",   name: "Status",   variants: [{ name: "Active", discriminant: 0 }] }
 * @example Result:      { type: "result", ok: { type: "u32" }, err: { type: "string" } }
 * @example Custom:      { type: "custom", name: "MyType" }
 */
export type TypeSpec =
  | { type: PrimitiveSorobanType; len?: number }
  | { type: "option"; inner: TypeSpec }
  | { type: "vec";    item:  TypeSpec }
  | { type: "map";    key:   TypeSpec; value: TypeSpec }
  | { type: "tuple";  fields: TypeSpec[] }
  | { type: "struct"; name: string; fields: StructField[] }
  | { type: "enum";   name: string; variants: EnumVariant[] }
  | { type: "result"; ok: TypeSpec; err: TypeSpec }
  | { type: "custom"; name: string };

/** A named field inside a struct type. */
export type StructField = {
  name: string;
  type: TypeSpec;
  doc?: string;
};

/** A variant inside an enum type. */
export type EnumVariant = {
  name: string;
  /** Integer discriminant value (0-based by default). */
  discriminant: number;
  /** Optional associated value type for tuple-style enum variants. */
  value?: TypeSpec;
  doc?: string;
};

// ---------------------------------------------------------------------------
// Function spec
// ---------------------------------------------------------------------------

/** A single input parameter of a contract function. */
export type ParameterSpec = {
  name: string;
  type: TypeSpec;
  doc?: string;
};

/**
 * Full description of one callable function on a Soroban contract.
 */
export type FunctionSpec = {
  /** Function name as it appears in the contract WASM. */
  name: string;
  /** Ordered list of input parameters. */
  params: ParameterSpec[];
  /**
   * Return type of the function.
   * Use `{ type: "void" }` for functions that return nothing.
   */
  returns: TypeSpec;
  doc?: string;
};

// ---------------------------------------------------------------------------
// Event spec
// ---------------------------------------------------------------------------

/** One positional topic slot in a contract event. */
export type TopicSpec = {
  /**
   * Position index (0-based) of this topic in the event's topics array.
   * The first topic is conventionally the event name / discriminator.
   */
  index: number;
  type: TypeSpec;
  doc?: string;
};

/**
 * Full description of one event emitted by a Soroban contract.
 */
export type EventSpec = {
  /**
   * Canonical event name — matches the first topic string by convention
   * (e.g. "transfer", "approve", "mint").
   */
  name: string;
  /** Typed description of each topic slot. */
  topics: TopicSpec[];
  /** Type of the event's data payload. Use `{ type: "void" }` if absent. */
  data: TypeSpec;
  doc?: string;
};

// ---------------------------------------------------------------------------
// Contract spec (top-level)
// ---------------------------------------------------------------------------

/**
 * Complete ABI spec for a single Soroban contract.
 * Serialisable to JSON and validatable against schema/spec.schema.json.
 */
export type ContractSpec = {
  /** Spec format version — MAJOR.MINOR.PATCH semver. */
  version: string;
  /** Canonical mainnet contract address (C-prefixed strkey, 56 chars). */
  contractId: string;
  /** Human-readable contract name. */
  name: string;
  /** Short description of the contract's purpose. */
  description?: string;
  /** All callable functions exposed by the contract. */
  functions: FunctionSpec[];
  /** All events the contract may emit. */
  events: EventSpec[];
  /** Any user-defined types (structs, enums) referenced by functions/events. */
  types?: TypeSpec[];
  /** Source reference — URL or identifier for the interface definition. */
  source?: string;
};
