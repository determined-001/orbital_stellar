import { describe, it, expect } from "vitest";
import {
  LATENCY_SENSITIVE_TIER_DEFAULT,
  TierEnableWithoutMeasurementError,
  assertTierEnableDecisionIsValid,
  type TierEnableDecision,
} from "../src/backstop/tiers.js";

describe("LATENCY_SENSITIVE_TIER_DEFAULT", () => {
  it("ships disabled", () => {
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.enabled).toBe(false);
  });

  it("is reversible by construction", () => {
    expect(LATENCY_SENSITIVE_TIER_DEFAULT.reversible).toBe(true);
  });

  it("is itself a valid decision", () => {
    expect(() => assertTierEnableDecisionIsValid(LATENCY_SENSITIVE_TIER_DEFAULT)).not.toThrow();
  });
});

describe("assertTierEnableDecisionIsValid", () => {
  it("rejects enabling the tier without a cost measurement", () => {
    const decision: TierEnableDecision = {
      enabled: true,
      decidedBy: "someone",
      decidedAt: "2026-08-29T00:00:00.000Z",
      rationale: "wanted it on",
      reversible: true,
    };

    expect(() => assertTierEnableDecisionIsValid(decision)).toThrow(
      TierEnableWithoutMeasurementError,
    );
  });

  it("accepts enabling the tier once a cost measurement is attached", () => {
    const decision: TierEnableDecision = {
      enabled: true,
      decidedBy: "someone",
      decidedAt: "2026-08-29T00:00:00.000Z",
      rationale: "measured via 21.2, published in the scorecard",
      reversible: true,
      costMeasurement: {
        measuredAt: "2026-08-28T00:00:00.000Z",
        sampleCount: 500,
        medianLatencyMs: 120,
        p99LatencyMs: 480,
        source: "scorecard-2026-08-28",
      },
    };

    expect(() => assertTierEnableDecisionIsValid(decision)).not.toThrow();
  });

  it("allows a disabled decision with no measurement at all", () => {
    const decision: TierEnableDecision = {
      enabled: false,
      decidedBy: "someone",
      decidedAt: "2026-08-29T00:00:00.000Z",
      rationale: "not ready",
      reversible: true,
    };

    expect(() => assertTierEnableDecisionIsValid(decision)).not.toThrow();
  });
});
