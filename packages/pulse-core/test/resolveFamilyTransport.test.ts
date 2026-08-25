/**
 * Transport routing decision layer (issue 6.12): `resolveFamilyTransport()`.
 *
 * This is a pure decision function only - it does not exercise live event
 * delivery/suppression, and it takes no dependency on a config flag for
 * selecting "unified"/"horizon"/"auto" (that's issue 6.11, a separate,
 * currently-unimplemented issue this one is blocked by but does not itself
 * implement). Callers resolve whatever mode-selection mechanism they use
 * down to a plain `"unified" | "horizon"` before calling this.
 */
import { describe, it, expect } from "vitest";
import { resolveFamilyTransport } from "../src/index.js";
import type { EventFamily } from "../src/index.js";

describe("resolveFamilyTransport() routing matrix", () => {
  const ALL_FAMILIES: EventFamily[] = [
    "payment",
    "trustlineAuth",
    "trustlineLimit",
    "accountCreated",
    "accountOptions",
    "accountMerge",
    "offer",
    "bumpSequence",
    "manageData",
    "claimableBalance",
    "liquidityPool",
  ];

  // Families with a CAP-67 unified equivalent per the mapping design doc.
  const UNIFIED_EQUIVALENT: EventFamily[] = ["payment", "trustlineAuth"];

  it("routes every family to horizon under effective mode horizon", () => {
    for (const family of ALL_FAMILIES) {
      expect(resolveFamilyTransport(family, "horizon")).toBe("horizon");
    }
  });

  it("routes families with a unified equivalent to unified under effective mode unified", () => {
    for (const family of UNIFIED_EQUIVALENT) {
      expect(resolveFamilyTransport(family, "unified")).toBe("unified");
    }
  });

  it("keeps Horizon-only families on horizon even under effective mode unified", () => {
    const horizonOnly = ALL_FAMILIES.filter((f) => !UNIFIED_EQUIVALENT.includes(f));
    for (const family of horizonOnly) {
      expect(resolveFamilyTransport(family, "unified")).toBe("horizon");
    }
  });
});
