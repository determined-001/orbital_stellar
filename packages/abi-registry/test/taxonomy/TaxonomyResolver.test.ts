import { describe, expect, it } from "vitest";
import {
  TaxonomyResolver,
  loadTaxonomyResolver,
  TaxonomyConflictError,
  InvalidTaxonomyRecordError,
} from "../../src/taxonomy/index.js";
import type { TaxonomyRecord } from "../../src/taxonomy/index.js";

function record(mappings: TaxonomyRecord["mappings"]): TaxonomyRecord {
  return { version: "1.0.0", mappings };
}

describe("TaxonomyResolver — precedence", () => {
  it("prefers an exact contractId rule over a specHash rule", () => {
    const resolver = loadTaxonomyResolver([
      record([
        { scope: { contractId: "CCONTRACT" }, eventTopic: "swap", semantic: "swap.executed" },
        { scope: { specHash: "hash1" }, eventTopic: "swap", semantic: "swap.other" },
      ]),
    ]);

    expect(resolver.resolve({ contractId: "CCONTRACT", specHash: "hash1", eventTopic: "swap" })).toBe(
      "swap.executed",
    );
  });

  it("prefers specHash over interfaceId when contractId doesn't match", () => {
    const resolver = loadTaxonomyResolver([
      record([
        { scope: { specHash: "hash1" }, eventTopic: "swap", semantic: "swap.hash_specific" },
        { scope: { interfaceId: "amm-v1" }, eventTopic: "swap", semantic: "swap.generic" },
      ]),
    ]);

    expect(
      resolver.resolve({ contractId: "CUNRELATED", specHash: "hash1", interfaceId: "amm-v1", eventTopic: "swap" }),
    ).toBe("swap.hash_specific");
  });

  it("falls back to interfaceId when no more specific rule matches", () => {
    const resolver = loadTaxonomyResolver([
      record([{ scope: { interfaceId: "sep41-sac" }, eventTopic: "transfer", semantic: "token.transferred" }]),
    ]);

    expect(resolver.resolve({ contractId: "CANY", interfaceId: "sep41-sac", eventTopic: "transfer" })).toBe(
      "token.transferred",
    );
  });

  it("resolves to undefined — never guessed — when nothing matches at any tier", () => {
    const resolver = loadTaxonomyResolver([
      record([{ scope: { contractId: "CKNOWN" }, eventTopic: "transfer", semantic: "token.transferred" }]),
    ]);

    expect(resolver.resolve({ contractId: "CUNKNOWN", eventTopic: "transfer" })).toBeUndefined();
    expect(resolver.resolve({ contractId: "CKNOWN", eventTopic: "unmapped_topic" })).toBeUndefined();
  });
});

describe("TaxonomyResolver — wildcard scopes", () => {
  it("matches by specHash across multiple contractIds sharing the same WASM", () => {
    const resolver = loadTaxonomyResolver([
      record([{ scope: { specHash: "sharedhash" }, eventTopic: "swap", semantic: "swap.executed" }]),
    ]);

    expect(resolver.resolve({ contractId: "CDEPLOY1", specHash: "sharedhash", eventTopic: "swap" })).toBe(
      "swap.executed",
    );
    expect(resolver.resolve({ contractId: "CDEPLOY2", specHash: "sharedhash", eventTopic: "swap" })).toBe(
      "swap.executed",
    );
  });

  it("matches by interfaceId across unrelated contracts implementing the same interface", () => {
    const resolver = loadTaxonomyResolver([
      record([{ scope: { interfaceId: "sep41-sac" }, eventTopic: "mint", semantic: "token.minted" }]),
    ]);

    expect(resolver.resolve({ contractId: "CTOKEN_A", interfaceId: "sep41-sac", eventTopic: "mint" })).toBe(
      "token.minted",
    );
    expect(resolver.resolve({ contractId: "CTOKEN_B", interfaceId: "sep41-sac", eventTopic: "mint" })).toBe(
      "token.minted",
    );
  });
});

describe("TaxonomyResolver — conflicts", () => {
  it("throws TaxonomyConflictError for two same-tier rules disagreeing on the same scope+topic", () => {
    expect(() =>
      loadTaxonomyResolver([
        record([
          { scope: { contractId: "CDUP" }, eventTopic: "swap", semantic: "swap.executed" },
          { scope: { contractId: "CDUP" }, eventTopic: "swap", semantic: "swap.different_name" },
        ]),
      ]),
    ).toThrow(TaxonomyConflictError);
  });

  it("does NOT throw for an identical duplicate mapping (same semantic)", () => {
    expect(() =>
      loadTaxonomyResolver([
        record([
          { scope: { contractId: "CDUP" }, eventTopic: "swap", semantic: "swap.executed" },
          { scope: { contractId: "CDUP" }, eventTopic: "swap", semantic: "swap.executed" },
        ]),
      ]),
    ).not.toThrow();
  });

  it("does NOT conflict across different tiers for the same key value", () => {
    // "X" as a contractId and "X" as a specHash are different tiers/namespaces.
    expect(() =>
      loadTaxonomyResolver([
        record([
          { scope: { contractId: "X" }, eventTopic: "swap", semantic: "swap.a" },
          { scope: { specHash: "X" }, eventTopic: "swap", semantic: "swap.b" },
        ]),
      ]),
    ).not.toThrow();
  });

  it("does NOT conflict for different eventTopics on the same scope", () => {
    expect(() =>
      loadTaxonomyResolver([
        record([
          { scope: { contractId: "CDUP" }, eventTopic: "transfer", semantic: "token.transferred" },
          { scope: { contractId: "CDUP" }, eventTopic: "mint", semantic: "token.minted" },
        ]),
      ]),
    ).not.toThrow();
  });
});

describe("TaxonomyResolver — validation", () => {
  it("rejects a record with an invalid semantic name shape", () => {
    expect(() =>
      loadTaxonomyResolver([record([{ scope: { contractId: "C" }, eventTopic: "swap", semantic: "NotDotted" }])]),
    ).toThrow(InvalidTaxonomyRecordError);
  });

  it("rejects a scope with zero or multiple keys", () => {
    expect(() =>
      loadTaxonomyResolver([
        record([{ scope: {} as never, eventTopic: "swap", semantic: "swap.executed" }]),
      ]),
    ).toThrow(InvalidTaxonomyRecordError);

    expect(() =>
      loadTaxonomyResolver([
        record([
          {
            scope: { contractId: "C", specHash: "H" } as never,
            eventTopic: "swap",
            semantic: "swap.executed",
          },
        ]),
      ]),
    ).toThrow(InvalidTaxonomyRecordError);
  });

  it("rejects a non-object document", () => {
    expect(() => loadTaxonomyResolver(["not an object" as never])).toThrow(InvalidTaxonomyRecordError);
  });

  it("loadTrusted skips schema validation but still enforces conflicts", () => {
    expect(() =>
      TaxonomyResolver.loadTrusted([
        { scope: { contractId: "C" }, eventTopic: "swap", semantic: "swap.a" },
        { scope: { contractId: "C" }, eventTopic: "swap", semantic: "swap.b" },
      ]),
    ).toThrow(TaxonomyConflictError);
  });
});
