/**
 * Tests for the semantic taxonomy resolver (#909). The acceptance criteria name
 * four behaviours explicitly - precedence, wildcards, the conflict error, and
 * unmapped passthrough - and each has a describe block below.
 */
import { describe, it, expect } from "vitest";
import {
  TaxonomyResolver,
  TaxonomyLoadError,
  AmbiguousTaxonomyError,
  type ResolvableEvent,
} from "../src/taxonomyResolver.js";
import type { TaxonomyEntry, TaxonomyScope, TaxonomyMatch } from "../src/taxonomy.js";
import { SEP41_TAXONOMY } from "../src/wellKnownTaxonomy.js";

const WASM = "a".repeat(64);
const SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const OTHER = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

function entry(over: Partial<TaxonomyEntry> & { id: string; name: string }): TaxonomyEntry {
  const match: TaxonomyMatch = over.match ?? {
    topics: [
      { kind: "symbol", symbol: "transfer" },
      { kind: "any", type: "address" },
      { kind: "any", type: "address" },
    ],
  };
  const scope: TaxonomyScope = over.scope ?? { kind: "contract", contractIds: [SAC] };
  return {
    version: "1.0.0",
    provenance: {
      submittedBy: "@octocat",
      submittedAt: "2026-09-06T00:00:00Z",
      sources: ["https://example.org/docs"],
    },
    ...over,
    match,
    scope,
  };
}

/** A SAC `transfer` event: symbol, two addresses. */
function transferEvent(over: Partial<ResolvableEvent> = {}): ResolvableEvent {
  return {
    contractId: SAC,
    topics: [
      { kind: "symbol", symbol: "transfer" },
      { kind: "value", type: "address" },
      { kind: "value", type: "address" },
    ],
    ...over,
  };
}

describe("TaxonomyResolver - loading", () => {
  it("rejects a set whose entries would resolve one event to two names", () => {
    // This is 7.7's collision policy, reused rather than reimplemented: the
    // same pattern in overlapping scopes mapping to different names is a
    // load-time error, never a silent pick.
    expect(
      () =>
        new TaxonomyResolver([
          entry({ id: "a", name: "payment.sent" }),
          entry({ id: "b", name: "payment.received" }),
        ]),
    ).toThrow(TaxonomyLoadError);
  });

  it("accepts two entries that agree, since agreement cannot mislead a consumer", () => {
    const r = new TaxonomyResolver([
      entry({ id: "a", name: "payment.sent" }),
      entry({ id: "b", name: "payment.sent" }),
    ]);
    expect(r.size).toBe(2);
  });

  it("rejects a duplicated id", () => {
    expect(
      () =>
        new TaxonomyResolver([
          entry({ id: "same", name: "payment.sent" }),
          entry({ id: "same", name: "payment.sent" }),
        ]),
    ).toThrow(TaxonomyLoadError);
  });

  it("rejects a structurally invalid entry rather than skipping it", () => {
    expect(
      () => new TaxonomyResolver([entry({ id: "bad", name: "not_a_namespace_root" })]),
    ).toThrow(TaxonomyLoadError);
  });

  it("allows an overlap that is explicitly a supersession", () => {
    const r = new TaxonomyResolver([
      entry({ id: "old", name: "payment.sent" }),
      entry({ id: "new", name: "payment.received", supersedes: ["old"] }),
    ]);
    expect(r.size).toBe(2);
  });
});

describe("TaxonomyResolver - precedence", () => {
  const contractScoped = entry({
    id: "by-contract",
    name: "payment.sent",
    scope: { kind: "contract", contractIds: [SAC] },
  });
  const wasmScoped = entry({
    id: "by-wasm",
    name: "asset.transferred",
    scope: { kind: "wasmHash", wasmHashes: [WASM] },
  });
  const interfaceScoped = entry({
    id: "by-interface",
    name: "swap.executed",
    scope: { kind: "interface", interface: "SEP-41" },
  });

  it("prefers an exact contract match over a wasm-hash family", () => {
    const r = new TaxonomyResolver([wasmScoped, contractScoped]);
    const res = r.resolve(transferEvent({ wasmHash: WASM }));
    expect(res).toMatchObject({ name: "payment.sent", scope: "contract" });
  });

  it("prefers a wasm-hash family over an interface match", () => {
    const r = new TaxonomyResolver([interfaceScoped, wasmScoped]);
    const res = r.resolve(transferEvent({ wasmHash: WASM, interfaces: ["SEP-41"] }));
    expect(res).toMatchObject({ name: "asset.transferred", scope: "wasmHash" });
  });

  it("falls back to an interface match when nothing narrower applies", () => {
    const r = new TaxonomyResolver([interfaceScoped]);
    const res = r.resolve(transferEvent({ contractId: OTHER, interfaces: ["SEP-41"] }));
    expect(res).toMatchObject({ name: "swap.executed", scope: "interface" });
  });

  it("uses the full precedence order when all three could apply", () => {
    const r = new TaxonomyResolver([interfaceScoped, wasmScoped, contractScoped]);
    const res = r.resolve(transferEvent({ wasmHash: WASM, interfaces: ["SEP-41"] }));
    expect(res?.scope).toBe("contract");
  });

  it("prefers a current entry over a retired one at the same specificity", () => {
    const r = new TaxonomyResolver([
      entry({ id: "retired", name: "payment.sent", deprecated: true }),
      entry({ id: "current", name: "payment.sent" }),
    ]);
    expect(r.resolve(transferEvent())).toMatchObject({ entryId: "current", deprecated: false });
  });

  it("still answers from a retired entry when it is all there is", () => {
    // Retired entries stay published for historical decoding, so they must
    // remain able to name an old event.
    const r = new TaxonomyResolver([
      entry({ id: "retired", name: "payment.sent", deprecated: true }),
    ]);
    expect(r.resolve(transferEvent())).toMatchObject({ deprecated: true });
  });

  it("lets a superseding entry win over the entry it replaced", () => {
    const r = new TaxonomyResolver([
      entry({ id: "old", name: "payment.sent" }),
      entry({ id: "new", name: "payment.received", supersedes: ["old"] }),
    ]);
    expect(r.resolve(transferEvent())).toMatchObject({ entryId: "new", name: "payment.received" });
  });
});

describe("TaxonomyResolver - wildcards and pattern matching", () => {
  it("matches an untyped `any` against any topic", () => {
    const r = new TaxonomyResolver([
      entry({
        id: "loose",
        name: "payment.sent",
        match: {
          topics: [{ kind: "symbol", symbol: "transfer" }, { kind: "any" }, { kind: "any" }],
        },
      }),
    ]);
    expect(r.resolve(transferEvent())).toMatchObject({ name: "payment.sent" });
  });

  it("does not match a typed `any` against a topic of a different type", () => {
    const r = new TaxonomyResolver([
      entry({
        id: "typed",
        name: "payment.sent",
        match: {
          topics: [
            { kind: "symbol", symbol: "transfer" },
            { kind: "any", type: "i128" },
            { kind: "any" },
          ],
        },
      }),
    ]);
    expect(r.resolve(transferEvent())).toBeNull();
  });

  it("does not match a typed `any` against a topic whose type was never decoded", () => {
    // Unknown is not compatible. Attaching a name to an event nobody verified
    // the shape of is the guess this resolver exists to refuse.
    const r = new TaxonomyResolver([entry({ id: "typed", name: "payment.sent" })]);
    const res = r.resolve(
      transferEvent({
        topics: [{ kind: "symbol", symbol: "transfer" }, { kind: "value" }, { kind: "value" }],
      }),
    );
    expect(res).toBeNull();
  });

  it("rejects extra topics by default", () => {
    const r = new TaxonomyResolver([entry({ id: "strict", name: "payment.sent" })]);
    const res = r.resolve(
      transferEvent({
        topics: [
          { kind: "symbol", symbol: "transfer" },
          { kind: "value", type: "address" },
          { kind: "value", type: "address" },
          { kind: "value", type: "address" },
        ],
      }),
    );
    expect(res).toBeNull();
  });

  it("tolerates extra topics when the entry allows them - the CAP-67 asset topic", () => {
    const r = new TaxonomyResolver([
      entry({
        id: "sac",
        name: "payment.sent",
        match: {
          topics: [
            { kind: "symbol", symbol: "transfer" },
            { kind: "any", type: "address" },
            { kind: "any", type: "address" },
          ],
          trailingTopics: "allowed",
        },
      }),
    ]);
    const res = r.resolve(
      transferEvent({
        topics: [
          { kind: "symbol", symbol: "transfer" },
          { kind: "value", type: "address" },
          { kind: "value", type: "address" },
          { kind: "value", type: "string" },
        ],
      }),
    );
    expect(res).toMatchObject({ name: "payment.sent" });
  });

  it("respects a network-scoped entry", () => {
    const r = new TaxonomyResolver([
      entry({
        id: "mainnet-only",
        name: "payment.sent",
        scope: { kind: "contract", contractIds: [SAC], networks: ["mainnet"] },
      }),
    ]);
    expect(r.resolve(transferEvent({ network: "mainnet" }))).not.toBeNull();
    expect(r.resolve(transferEvent({ network: "testnet" }))).toBeNull();
    // Unknown network must not be assumed to be the scoped one.
    expect(r.resolve(transferEvent())).toBeNull();
  });

  it("does not match a wasm-hash entry when the event's hash is unknown", () => {
    const r = new TaxonomyResolver([
      entry({ id: "fam", name: "payment.sent", scope: { kind: "wasmHash", wasmHashes: [WASM] } }),
    ]);
    expect(r.resolve(transferEvent())).toBeNull();
  });
});

describe("TaxonomyResolver - ambiguity at resolve time", () => {
  it("throws rather than picking when two equally specific entries disagree", () => {
    // These patterns are not identical, so findTaxonomyConflicts cannot catch
    // them at load - but one concrete event matches both.
    const r = new TaxonomyResolver([
      entry({
        id: "loose",
        name: "payment.sent",
        match: {
          topics: [{ kind: "symbol", symbol: "transfer" }, { kind: "any" }, { kind: "any" }],
        },
      }),
      entry({
        id: "typed",
        name: "asset.transferred",
        match: {
          topics: [
            { kind: "symbol", symbol: "transfer" },
            { kind: "any", type: "address" },
            { kind: "any", type: "address" },
          ],
        },
      }),
    ]);
    expect(() => r.resolve(transferEvent())).toThrow(AmbiguousTaxonomyError);
  });

  it("does not throw when both entries agree on the name", () => {
    const r = new TaxonomyResolver([
      entry({
        id: "loose",
        name: "payment.sent",
        match: {
          topics: [{ kind: "symbol", symbol: "transfer" }, { kind: "any" }, { kind: "any" }],
        },
      }),
      entry({ id: "typed", name: "payment.sent" }),
    ]);
    expect(r.resolve(transferEvent())).toMatchObject({ name: "payment.sent" });
  });
});

describe("TaxonomyResolver - unmapped passthrough", () => {
  it("returns null for a contract nothing covers", () => {
    const r = new TaxonomyResolver([entry({ id: "a", name: "payment.sent" })]);
    expect(r.resolve(transferEvent({ contractId: OTHER }))).toBeNull();
  });

  it("returns null for a different event on a covered contract", () => {
    const r = new TaxonomyResolver([entry({ id: "a", name: "payment.sent" })]);
    const res = r.resolve(
      transferEvent({
        topics: [
          { kind: "symbol", symbol: "mint" },
          { kind: "value", type: "address" },
        ],
      }),
    );
    expect(res).toBeNull();
  });

  it("returns null from an empty taxonomy rather than failing", () => {
    expect(new TaxonomyResolver([]).resolve(transferEvent())).toBeNull();
  });
});

describe("SEP41_TAXONOMY", () => {
  const r = new TaxonomyResolver([...SEP41_TAXONOMY]);

  function sacEvent(symbol: string, addressTopics: number, trailingAsset = false): ResolvableEvent {
    return {
      contractId: SAC,
      interfaces: ["SEP-41"],
      dataShape: "scalar",
      topics: [
        { kind: "symbol", symbol },
        ...Array.from(
          { length: addressTopics },
          () => ({ kind: "value", type: "address" }) as const,
        ),
        ...(trailingAsset ? [{ kind: "value", type: "string" } as const] : []),
      ],
    };
  }

  it("loads as a conflict-free set", () => {
    expect(r.size).toBe(4);
  });

  it.each([
    ["transfer", 2, "asset.transferred"],
    ["mint", 2, "asset.minted"],
    ["burn", 1, "asset.burned"],
    ["clawback", 2, "asset.clawed_back"],
  ])("resolves %s to %s", (symbol, topics, expected) => {
    expect(r.resolve(sacEvent(symbol, topics as number))).toMatchObject({
      name: expected,
      scope: "interface",
    });
  });

  it("still resolves when CAP-67 appends the asset topic", () => {
    // The reason every SEP-41 entry sets trailingTopics: "allowed". A strict
    // arity would have stopped matching real SAC events on a protocol upgrade.
    expect(r.resolve(sacEvent("transfer", 2, true))).toMatchObject({ name: "asset.transferred" });
  });

  it("does not name an event from a contract that has not been established as SEP-41", () => {
    const { interfaces: _drop, ...withoutInterface } = sacEvent("transfer", 2);
    expect(r.resolve(withoutInterface)).toBeNull();
  });

  it("does not name a SEP-41 event it has no entry for", () => {
    expect(r.resolve(sacEvent("set_authorized", 2))).toBeNull();
  });
});
