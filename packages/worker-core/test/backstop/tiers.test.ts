import { describe, expect, it } from "vitest";

import {
  TIERS,
  guaranteeDeadline,
  registrableTiers,
  tierDefinition,
  withinGuarantee,
} from "../../src/backstop/index.js";
import type { TierId } from "../../src/backstop/index.js";
import {
  LATENCY_SENSITIVE_TIER_DEFAULT,
  TierEnableWithoutMeasurementError,
  assertTierEnableDecisionIsValid,
  type TierEnableDecision,
} from "../../src/backstop/tiers.js";

describe("tier definitions", () => {
  it("states latency bound, grace period, price and guarantee conditions for every tier", () => {
    for (const id of Object.keys(TIERS) as TierId[]) {
      const tier = tierDefinition(id);
      expect(tier.bounds.latencyBoundMs).toBeGreaterThan(0);
      expect(tier.bounds.gracePeriodMs).toBeGreaterThan(0);
      expect(tier.pricePerWindowStroops).toBeGreaterThan(0n);
      // The conditions are data, not prose: 21.4 has to assert against them.
      expect(tier.bounds.guaranteedWhen).toMatchObject({
        subscriptionActive: true,
        triggerPermissionless: true,
        fundsInPlace: true,
      });
      expect(tier.bounds.guaranteedWhen.maxFeeMultiplier).toBeGreaterThan(0);
    }
  });

  it("prices in integer stroops, never a float", () => {
    for (const id of Object.keys(TIERS) as TierId[]) {
      expect(typeof tierDefinition(id).pricePerWindowStroops).toBe("bigint");
    }
  });

  it("ships the time-insensitive tier and nothing else", () => {
    expect(registrableTiers()).toEqual(["time-insensitive"]);
    expect(TIERS["time-insensitive"].registrable).toBe(true);

    // Defined, so the abstraction holds it — but not registrable, so the
    // expensive promise cannot be made before 22.4's infrastructure exists.
    expect(TIERS["latency-sensitive"]).toBeDefined();
    expect(TIERS["latency-sensitive"].registrable).toBe(false);
    expect(TIERS["latency-sensitive"].enabledBy).toBe("22.4");
  });

  it("makes the cheap tier the loose one and the expensive tier the tight one", () => {
    // The whole reason for tiers: an hour late is a non-event for payroll and
    // fatal for the other product, and the price follows the promise.
    expect(TIERS["latency-sensitive"].bounds.latencyBoundMs).toBeLessThan(
      TIERS["time-insensitive"].bounds.latencyBoundMs,
    );
    expect(TIERS["latency-sensitive"].pricePerWindowStroops).toBeGreaterThan(
      TIERS["time-insensitive"].pricePerWindowStroops,
    );
  });
});

describe("guarantee boundaries", () => {
  const DUE = 1_700_000_000_000;

  it("computes the same deadline 21.4 will assert against", () => {
    const { latencyBoundMs, gracePeriodMs } = TIERS["time-insensitive"].bounds;
    expect(guaranteeDeadline("time-insensitive", DUE)).toBe(DUE + latencyBoundMs + gracePeriodMs);
  });

  it("holds up to the bound plus grace, and breaches after", () => {
    const deadline = guaranteeDeadline("time-insensitive", DUE);
    expect(withinGuarantee("time-insensitive", DUE, DUE)).toBe(true);
    expect(withinGuarantee("time-insensitive", DUE, deadline)).toBe(true);
    expect(withinGuarantee("time-insensitive", DUE, deadline + 1)).toBe(false);
  });

  it("treats an early fire as within the guarantee", () => {
    expect(withinGuarantee("time-insensitive", DUE, DUE - 60_000)).toBe(true);
  });
});

describe("the expensive tier has one switch, not two", () => {
  // 22.4 (#1071) landed its enable decision in this module before 21.3 landed
  // the tier table. Two independent booleans for one safety property is how a
  // tier gets sold while the decision record still says disabled, so the table
  // derives from the record rather than restating it.
  it("takes registrability from 22.4's enable decision", () => {
    expect(TIERS["latency-sensitive"].registrable).toBe(LATENCY_SENSITIVE_TIER_DEFAULT.enabled);
  });

  it("ships that decision disabled, documented and reversible", () => {
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.enabled).toBe(false);
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.reversible).toBe(true);
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.rationale).not.toBe("");
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.costMeasurement).toBeUndefined();
  });

  it("still refuses an enable decision with no cost measurement", () => {
    // The guard the tier table runs on the way to `registrable`. If this ever
    // stops throwing, enabling the tier stops requiring 21.2's measurement.
    const decision: TierEnableDecision = {
      enabled: true,
      decidedBy: "someone",
      decidedAt: "2026-09-04T00:00:00.000Z",
      rationale: "wanted it on",
      reversible: true,
    };

    expect(() => assertTierEnableDecisionIsValid(decision)).toThrow(
      TierEnableWithoutMeasurementError,
    );
  });
});
