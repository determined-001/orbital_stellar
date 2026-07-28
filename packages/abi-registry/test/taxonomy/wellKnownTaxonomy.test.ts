import { describe, expect, it } from "vitest";
import {
  loadTaxonomyResolver,
  wellKnownTaxonomy,
  SEP41_SAC_INTERFACE_ID,
  SOROBAN_AMM_V1_INTERFACE_ID,
} from "../../src/taxonomy/index.js";

describe("wellKnownTaxonomy", () => {
  it("loads without a TaxonomyConflictError", () => {
    expect(() => loadTaxonomyResolver([wellKnownTaxonomy])).not.toThrow();
  });

  it("resolves the SAC transfer/mint/burn/clawback event set", () => {
    const resolver = loadTaxonomyResolver([wellKnownTaxonomy]);
    const contractId = "CANYTOKEN";

    expect(resolver.resolve({ contractId, interfaceId: SEP41_SAC_INTERFACE_ID, eventTopic: "transfer" })).toBe(
      "token.transferred",
    );
    expect(resolver.resolve({ contractId, interfaceId: SEP41_SAC_INTERFACE_ID, eventTopic: "mint" })).toBe(
      "token.minted",
    );
    expect(resolver.resolve({ contractId, interfaceId: SEP41_SAC_INTERFACE_ID, eventTopic: "burn" })).toBe(
      "token.burned",
    );
    expect(resolver.resolve({ contractId, interfaceId: SEP41_SAC_INTERFACE_ID, eventTopic: "clawback" })).toBe(
      "token.clawed_back",
    );
  });

  it("resolves the illustrative AMM swap shape", () => {
    const resolver = loadTaxonomyResolver([wellKnownTaxonomy]);
    expect(
      resolver.resolve({ contractId: "CANYAMM", interfaceId: SOROBAN_AMM_V1_INTERFACE_ID, eventTopic: "swap" }),
    ).toBe("swap.executed");
  });

  it("stays unmapped without the interfaceId hint — never guessed", () => {
    const resolver = loadTaxonomyResolver([wellKnownTaxonomy]);
    expect(resolver.resolve({ contractId: "CANYTOKEN", eventTopic: "transfer" })).toBeUndefined();
  });

  it("stays unmapped for an event topic the bundled taxonomy doesn't cover", () => {
    const resolver = loadTaxonomyResolver([wellKnownTaxonomy]);
    expect(
      resolver.resolve({ contractId: "CANYTOKEN", interfaceId: SEP41_SAC_INTERFACE_ID, eventTopic: "approve" }),
    ).toBeUndefined();
  });
});
