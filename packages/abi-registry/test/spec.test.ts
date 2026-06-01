import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContractSpec as ContractAbiSpec,
  FunctionSpec,
  EventSpec,
  TypeSpec,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(resolve(__dirname, "../schema/spec.schema.json"), "utf8")
);

// ---------------------------------------------------------------------------
// Representative ABI spec — SEP-41 token (USDC-shaped)
// ---------------------------------------------------------------------------

const ADDRESS: TypeSpec = { type: "address" };
const I128: TypeSpec    = { type: "i128" };
const U32: TypeSpec     = { type: "u32" };
const BOOL: TypeSpec    = { type: "bool" };
const STRING: TypeSpec  = { type: "string" };
const VOID: TypeSpec    = { type: "void" };

const transferFn: FunctionSpec = {
  name: "transfer",
  doc: "Transfer amount tokens from `from` to `to`.",
  params: [
    { name: "from",   type: ADDRESS },
    { name: "to",     type: ADDRESS },
    { name: "amount", type: I128 },
  ],
  returns: VOID,
};

const approveFn: FunctionSpec = {
  name: "approve",
  params: [
    { name: "from",              type: ADDRESS },
    { name: "spender",           type: ADDRESS },
    { name: "amount",            type: I128 },
    { name: "expiration_ledger", type: U32 },
  ],
  returns: VOID,
};

const allowanceFn: FunctionSpec = {
  name: "allowance",
  params: [
    { name: "from",    type: ADDRESS },
    { name: "spender", type: ADDRESS },
  ],
  returns: I128,
};

const balanceFn: FunctionSpec = {
  name: "balance",
  params: [{ name: "id", type: ADDRESS }],
  returns: I128,
};

const decimalsFn: FunctionSpec = {
  name: "decimals",
  params: [],
  returns: U32,
};

const nameFn: FunctionSpec = {
  name: "name",
  params: [],
  returns: STRING,
};

const symbolFn: FunctionSpec = {
  name: "symbol",
  params: [],
  returns: STRING,
};

const authorizedFn: FunctionSpec = {
  name: "authorized",
  params: [{ name: "id", type: ADDRESS }],
  returns: BOOL,
};

const transferEvent: EventSpec = {
  name: "transfer",
  doc: "Emitted on every successful token transfer.",
  topics: [
    { index: 0, type: { type: "symbol" }, doc: "Event name — always 'transfer'." },
    { index: 1, type: ADDRESS,            doc: "Sender address." },
    { index: 2, type: ADDRESS,            doc: "Recipient address." },
  ],
  data: I128,
};

const approveEvent: EventSpec = {
  name: "approve",
  topics: [
    { index: 0, type: { type: "symbol" } },
    { index: 1, type: ADDRESS },
    { index: 2, type: ADDRESS },
  ],
  data: {
    type: "struct",
    name: "ApproveData",
    fields: [
      { name: "amount",            type: I128 },
      { name: "expiration_ledger", type: U32 },
    ],
  },
};

const representativeSpec: ContractAbiSpec = {
  version: "1.0.0",
  contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  name: "USD Coin (USDC)",
  description: "Circle USDC on Stellar mainnet — SEP-41 token interface.",
  source: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
  functions: [
    transferFn,
    approveFn,
    allowanceFn,
    balanceFn,
    decimalsFn,
    nameFn,
    symbolFn,
    authorizedFn,
  ],
  events: [transferEvent, approveEvent],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContractAbiSpec — schema validation", () => {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  it("representative USDC spec validates against spec.schema.json", () => {
    const valid = validate(representativeSpec);
    if (!valid) {
      console.error(validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("rejects a spec missing required contractId", () => {
    const bad = { ...representativeSpec, contractId: undefined };
    expect(validate(bad)).toBe(false);
  });

  it("rejects a spec with a malformed contractId (not C-prefixed strkey)", () => {
    const bad = { ...representativeSpec, contractId: "GABC1234" };
    expect(validate(bad)).toBe(false);
  });

  it("rejects a spec with a malformed version string", () => {
    const bad = { ...representativeSpec, version: "v1" };
    expect(validate(bad)).toBe(false);
  });

  it("rejects a function entry missing returns", () => {
    const badFn = { name: "transfer", params: [] }; // no returns
    const bad = { ...representativeSpec, functions: [badFn] };
    expect(validate(bad)).toBe(false);
  });

  it("rejects an event entry missing data", () => {
    const badEvent = { name: "transfer", topics: [] }; // no data
    const bad = { ...representativeSpec, events: [badEvent] };
    expect(validate(bad)).toBe(false);
  });
});

describe("ContractAbiSpec — TypeSpec coverage", () => {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  function specWith(fnType: TypeSpec): ContractAbiSpec {
    return {
      ...representativeSpec,
      functions: [{ name: "fn", params: [{ name: "x", type: fnType }], returns: VOID }],
      events: [],
    };
  }

  it("accepts option<address>", () => {
    expect(validate(specWith({ type: "option", inner: ADDRESS }))).toBe(true);
  });

  it("accepts vec<i128>", () => {
    expect(validate(specWith({ type: "vec", item: I128 }))).toBe(true);
  });

  it("accepts map<string, u32>", () => {
    expect(validate(specWith({ type: "map", key: STRING, value: U32 }))).toBe(true);
  });

  it("accepts tuple<address, i128>", () => {
    expect(validate(specWith({ type: "tuple", fields: [ADDRESS, I128] }))).toBe(true);
  });

  it("accepts result<u32, string>", () => {
    expect(validate(specWith({ type: "result", ok: U32, err: STRING }))).toBe(true);
  });

  it("accepts custom named type reference", () => {
    expect(validate(specWith({ type: "custom", name: "MyStruct" }))).toBe(true);
  });

  it("accepts bytes_n with len", () => {
    expect(validate(specWith({ type: "bytes_n", len: 32 }))).toBe(true);
  });

  it("accepts nested struct with enum field", () => {
    const nested: TypeSpec = {
      type: "struct",
      name: "Outer",
      fields: [
        {
          name: "status",
          type: {
            type: "enum",
            name: "Status",
            variants: [
              { name: "Active",   discriminant: 0 },
              { name: "Inactive", discriminant: 1 },
            ],
          },
        },
      ],
    };
    expect(validate(specWith(nested))).toBe(true);
  });
});
