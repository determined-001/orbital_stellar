import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// taxonomy.schema.json declares JSON Schema 2020-12, so it needs ajv's 2020
// entry point rather than the draft-07 default export.
import Ajv2020 from "ajv/dist/2020.js";
import {
  validateTaxonomyEntry,
  findTaxonomyConflicts,
  TAXONOMY_NAMESPACE_ROOTS,
  RESERVED_TAXONOMY_NAMESPACE_ROOTS,
  TAXONOMY_NAME_RE,
} from "../src/taxonomy.js";
import type { TaxonomyEntry } from "../src/taxonomy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "../schema");
const EXAMPLES_DIR = resolve(SCHEMA_DIR, "examples/taxonomy");

const EXAMPLE_FILES = ["payment-sent-sep41-transfer.json", "swap-executed-example-dex.json"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

const taxonomySchema = readJson(resolve(SCHEMA_DIR, "taxonomy.schema.json"));
const specSchema = readJson(resolve(SCHEMA_DIR, "spec.schema.json"));

function compileTaxonomySchema() {
  const ajv = new Ajv2020({ allErrors: true });
  // `date-time` is the only format the schema uses. Declared explicitly rather
  // than pulling in ajv-formats for one keyword.
  ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  return ajv.compile(taxonomySchema);
}

const validateAgainstSchema = compileTaxonomySchema();

/** Minimal entry every negative fixture is a single mutation away from. */
function baseEntry(): Record<string, unknown> {
  return {
    id: "payment-sent-example",
    version: "1.0.0",
    name: "payment.sent",
    match: {
      topics: [
        { kind: "symbol", symbol: "transfer" },
        { kind: "any", type: "address" },
      ],
    },
    parameters: {
      from: { from: "topic", index: 1, type: "address" },
      amount: { from: "data", type: "i128" },
    },
    scope: { kind: "interface", interface: "SEP-41" },
    provenance: {
      submittedBy: "@octocat",
      submittedAt: "2026-07-29T00:00:00Z",
      sources: ["https://example.com/docs"],
    },
  };
}

function withOverride(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...baseEntry(), ...patch };
}

describe("bundled taxonomy examples", () => {
  it.each(EXAMPLE_FILES)("%s passes validateTaxonomyEntry", (file) => {
    const result = validateTaxonomyEntry(readJson(resolve(EXAMPLES_DIR, file)));

    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(EXAMPLE_FILES)("%s validates against taxonomy.schema.json", (file) => {
    const valid = validateAgainstSchema(readJson(resolve(EXAMPLES_DIR, file)));

    expect(validateAgainstSchema.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("covers both an interface-scoped and a contract-scoped entry", () => {
    const scopes = EXAMPLE_FILES.map(
      (file) => (readJson(resolve(EXAMPLES_DIR, file))["scope"] as { kind: string }).kind,
    );

    expect(new Set(scopes)).toEqual(new Set(["interface", "contract"]));
  });

  it("does not collide with itself", () => {
    const entries = EXAMPLE_FILES.map(
      (file) => readJson(resolve(EXAMPLES_DIR, file)) as unknown as TaxonomyEntry,
    );

    expect(findTaxonomyConflicts(entries)).toEqual([]);
  });
});

describe("naming rules", () => {
  it("accepts two- and three-segment names under an allowed root", () => {
    expect(TAXONOMY_NAME_RE.test("swap.executed")).toBe(true);
    expect(TAXONOMY_NAME_RE.test("loan.liquidated")).toBe(true);
    expect(TAXONOMY_NAME_RE.test("payment.received")).toBe(true);
    expect(TAXONOMY_NAME_RE.test("lp.position.closed")).toBe(true);
  });

  it("rejects unknown roots, so one concept cannot be named two ways", () => {
    expect(TAXONOMY_NAME_RE.test("dex.swapped")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("lending.liquidated")).toBe(false);
  });

  it("rejects pulse-core's reserved diagnostic roots", () => {
    for (const root of RESERVED_TAXONOMY_NAMESPACE_ROOTS) {
      expect(TAXONOMY_NAMESPACE_ROOTS as readonly string[]).not.toContain(root);
      expect(TAXONOMY_NAME_RE.test(`${root}.something_happened`)).toBe(false);
    }
    expect(TAXONOMY_NAME_RE.test("engine.reconnecting")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("event.decode_failed")).toBe(false);
  });

  it("rejects wrong segment counts and wrong casing", () => {
    expect(TAXONOMY_NAME_RE.test("payment")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("payment.a.b.c")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("payment.Sent")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("payment.sent-out")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("payment.2fa")).toBe(false);
    expect(TAXONOMY_NAME_RE.test("Payment.sent")).toBe(false);
  });
});

describe("schema and TypeScript mirror stay in step", () => {
  it("derives the schema's name pattern from TAXONOMY_NAMESPACE_ROOTS", () => {
    const defs = taxonomySchema["$defs"] as Record<string, { pattern?: string }>;

    expect(defs["TaxonomyName"]!.pattern).toBe(TAXONOMY_NAME_RE.source);
  });

  it("uses the same PrimitiveType set as spec.schema.json", () => {
    const taxonomyDefs = taxonomySchema["$defs"] as Record<string, { enum?: string[] }>;
    const specDefs = specSchema["$defs"] as Record<string, { enum?: string[] }>;

    expect(taxonomyDefs["PrimitiveType"]!.enum).toEqual(specDefs["PrimitiveType"]!.enum);
  });
});

describe("validateTaxonomyEntry", () => {
  it("accepts the base entry", () => {
    expect(validateTaxonomyEntry(baseEntry())).toEqual({ valid: true });
  });

  it("rejects a non-object", () => {
    expect(validateTaxonomyEntry("nope")).toEqual({
      valid: false,
      errors: ["root: TaxonomyEntry must be an object"],
    });
  });

  it("collects every problem instead of stopping at the first", () => {
    const result = validateTaxonomyEntry({ id: "Bad_Id", version: "1.0", name: "dex.swapped" });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
      expect(result.errors.some((e) => e.startsWith("id:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("version:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("name:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("match:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("scope:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("provenance:"))).toBe(true);
    }
  });

  it("requires at least one provenance source", () => {
    const result = validateTaxonomyEntry(
      withOverride({
        provenance: { submittedBy: "@octocat", submittedAt: "2026-07-29T00:00:00Z", sources: [] },
      }),
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("provenance.sources: must list at least one source URL");
    }
  });

  it("accepts every documented parameter source", () => {
    const result = validateTaxonomyEntry(
      withOverride({
        parameters: {
          from: { from: "topic", index: 1, type: "address" },
          amount: { from: "data", type: "i128" },
          token_in: { from: "data", path: "token_in", type: "address" },
          direction: { from: "constant", value: "out" },
        },
      }),
    );

    expect(result).toEqual({ valid: true });
  });

  it("accepts every documented scope kind", () => {
    const scopes = [
      {
        kind: "contract",
        contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"],
      },
      { kind: "wasmHash", wasmHashes: ["a".repeat(64)] },
      { kind: "interface", interface: "SEP-41", networks: ["mainnet", "testnet"] },
    ];

    for (const scope of scopes) {
      expect(validateTaxonomyEntry(withOverride({ scope }))).toEqual({ valid: true });
    }
  });
});

// Every fixture here must be rejected by BOTH the hand-written validator and the
// JSON Schema - that agreement is the only thing keeping the two in step, since
// neither is generated from the other. Unknown-property cases are deliberately
// absent: the schema is additionalProperties:false, the validator ignores them.
const INVALID_FIXTURES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["id that is not a kebab-case slug", withOverride({ id: "Not_A_Slug" })],
  ["version that is not semver", withOverride({ version: "1.0" })],
  ["name under an unlisted root", withOverride({ name: "dex.swapped" })],
  ["name under a reserved root", withOverride({ name: "engine.reconnecting" })],
  ["single-segment name", withOverride({ name: "payment" })],
  ["four-segment name", withOverride({ name: "payment.a.b.c" })],
  ["uppercase in a name", withOverride({ name: "payment.Sent" })],
  ["empty topic pattern", withOverride({ match: { topics: [] } })],
  [
    "unknown topic matcher kind",
    withOverride({ match: { topics: [{ kind: "regex", pattern: "trans.*" }] } }),
  ],
  [
    "unknown primitive type in a matcher",
    withOverride({ match: { topics: [{ kind: "any", type: "uint256" }] } }),
  ],
  [
    "trailingTopics outside its enum",
    withOverride({
      match: { topics: [{ kind: "symbol", symbol: "transfer" }], trailingTopics: "maybe" },
    }),
  ],
  [
    "dataShape outside its enum",
    withOverride({
      match: { topics: [{ kind: "symbol", symbol: "transfer" }], dataShape: "struct" },
    }),
  ],
  [
    "parameter from an unknown source",
    withOverride({ parameters: { from: { from: "ledger", type: "address" } } }),
  ],
  [
    "negative topic index",
    withOverride({ parameters: { from: { from: "topic", index: -1, type: "address" } } }),
  ],
  [
    "parameter name that is not snake_case",
    withOverride({ parameters: { "From Address": { from: "topic", index: 1, type: "address" } } }),
  ],
  ["unknown scope kind", withOverride({ scope: { kind: "deployer", deployer: "GABC" } })],
  ["malformed contract id", withOverride({ scope: { kind: "contract", contractIds: ["CBAD"] } })],
  ["empty contract id list", withOverride({ scope: { kind: "contract", contractIds: [] } })],
  [
    "wasm hash that is not 64 lowercase hex",
    withOverride({ scope: { kind: "wasmHash", wasmHashes: ["A".repeat(64)] } }),
  ],
  [
    "interface that is not a SEP id",
    withOverride({ scope: { kind: "interface", interface: "sep41" } }),
  ],
  [
    "network outside its enum",
    withOverride({ scope: { kind: "interface", interface: "SEP-41", networks: ["pubnet"] } }),
  ],
  [
    "provenance source that is not a URL",
    withOverride({
      provenance: {
        submittedBy: "@octocat",
        submittedAt: "2026-07-29T00:00:00Z",
        sources: ["see the docs"],
      },
    }),
  ],
  [
    "provenance timestamp that is not ISO 8601",
    withOverride({
      provenance: {
        submittedBy: "@octocat",
        submittedAt: "last Tuesday",
        sources: ["https://example.com/docs"],
      },
    }),
  ],
  ["supersedes entry that is not a slug", withOverride({ supersedes: ["Not_A_Slug"] })],
  ["deprecated that is not a boolean", withOverride({ deprecated: "yes" })],
];

describe.each(INVALID_FIXTURES)("rejects %s", (_label, fixture) => {
  it("via validateTaxonomyEntry", () => {
    expect(validateTaxonomyEntry(fixture).valid).toBe(false);
  });

  it("via taxonomy.schema.json", () => {
    expect(validateAgainstSchema(fixture)).toBe(false);
  });
});

describe("findTaxonomyConflicts", () => {
  const sep41Transfer = {
    match: {
      topics: [
        { kind: "symbol", symbol: "transfer" },
        { kind: "any", type: "address" },
      ],
    },
    scope: { kind: "interface", interface: "SEP-41" },
    provenance: {
      submittedBy: "@octocat",
      submittedAt: "2026-07-29T00:00:00Z",
      sources: ["https://example.com/docs"],
    },
  } as const;

  function entry(overrides: Partial<TaxonomyEntry>): TaxonomyEntry {
    return {
      id: "entry",
      version: "1.0.0",
      name: "payment.sent",
      ...sep41Transfer,
      ...overrides,
    } as TaxonomyEntry;
  }

  it("reports nothing for a single entry", () => {
    expect(findTaxonomyConflicts([entry({ id: "a" })])).toEqual([]);
  });

  it("reports a duplicate id", () => {
    const conflicts = findTaxonomyConflicts([
      entry({ id: "same" }),
      entry({ id: "same", name: "payment.received" }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("duplicate-id");
  });

  it("reports an ambiguous mapping when one pattern yields two names", () => {
    const conflicts = findTaxonomyConflicts([
      entry({ id: "a", name: "payment.sent" }),
      entry({ id: "b", name: "payment.received" }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("ambiguous-mapping");
    expect(conflicts[0]!.entryIds).toEqual(["a", "b"]);
    expect(conflicts[0]!.detail).toContain("payment.sent");
    expect(conflicts[0]!.detail).toContain("payment.received");
  });

  it("reports a duplicate mapping when two entries say the same thing", () => {
    const conflicts = findTaxonomyConflicts([entry({ id: "a" }), entry({ id: "b" })]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("duplicate-mapping");
  });

  it("treats an explicit supersession as intentional", () => {
    const conflicts = findTaxonomyConflicts([
      entry({ id: "old", name: "payment.received" }),
      entry({ id: "new", name: "payment.sent", supersedes: ["old"] }),
    ]);

    expect(conflicts).toEqual([]);
  });

  it("does not flag entries whose patterns differ", () => {
    const conflicts = findTaxonomyConflicts([
      entry({ id: "a" }),
      entry({
        id: "b",
        name: "payment.received",
        match: { topics: [{ kind: "symbol", symbol: "mint" }] },
      }),
    ]);

    expect(conflicts).toEqual([]);
  });

  it("treats trailingTopics as part of the pattern, defaulting to forbidden", () => {
    const strict = entry({ id: "a" });
    const explicitDefault = entry({
      id: "b",
      match: { ...sep41Transfer.match, trailingTopics: "forbidden" },
    });
    const loose = entry({
      id: "c",
      match: { ...sep41Transfer.match, trailingTopics: "allowed" },
    });

    expect(findTaxonomyConflicts([strict, explicitDefault])).toHaveLength(1);
    expect(findTaxonomyConflicts([strict, loose])).toEqual([]);
  });

  it("does not flag scopes restricted to disjoint networks", () => {
    const conflicts = findTaxonomyConflicts([
      entry({
        id: "a",
        scope: { kind: "interface", interface: "SEP-41", networks: ["mainnet"] },
      }),
      entry({
        id: "b",
        name: "payment.received",
        scope: { kind: "interface", interface: "SEP-41", networks: ["testnet"] },
      }),
    ]);

    expect(conflicts).toEqual([]);
  });

  it("does not flag scopes of different kinds - that overlap needs on-chain state", () => {
    const conflicts = findTaxonomyConflicts([
      entry({ id: "a" }),
      entry({
        id: "b",
        name: "payment.received",
        scope: {
          kind: "contract",
          contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"],
        },
      }),
    ]);

    expect(conflicts).toEqual([]);
  });

  it("flags contract scopes that share a single contract id", () => {
    const shared = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    const other = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

    const conflicts = findTaxonomyConflicts([
      entry({ id: "a", scope: { kind: "contract", contractIds: [shared, other] } }),
      entry({
        id: "b",
        name: "payment.received",
        scope: { kind: "contract", contractIds: [shared] },
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("ambiguous-mapping");
  });
});
