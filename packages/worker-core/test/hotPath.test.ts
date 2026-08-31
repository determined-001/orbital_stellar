import { describe, it, expect } from "vitest";
import {
  isPreSignable,
  recordScorecardEntry,
  assertHotPathReady,
  HotPathNotImplementedError,
  type HotPathPlan,
} from "../src/hotPath/index.js";
import { LATENCY_SENSITIVE_TIER_DEFAULT } from "../src/backstop/tiers.js";

describe("isPreSignable", () => {
  it("is true for a static plan (fixed args, nothing left to observe)", () => {
    const plan: HotPathPlan<[string]> = {
      kind: "static",
      workerId: "w1",
      targetContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      functionName: "disburse",
      latencyBudget: { maxLedgers: 1 },
      args: ["fixed-arg"],
    };
    expect(isPreSignable(plan)).toBe(true);
  });

  it("is false for a dynamic plan, unconditionally", () => {
    const plan: HotPathPlan<[string]> = {
      kind: "dynamic",
      workerId: "w1",
      targetContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      functionName: "disburse",
      latencyBudget: { maxLedgers: 1 },
      buildArgs: () => ["observed-at-submit-time"],
    };
    expect(isPreSignable(plan)).toBe(false);
  });
});

describe("recordScorecardEntry", () => {
  it("computes latencyMs and withinBudget from raw observations", () => {
    const entry = recordScorecardEntry({
      workerId: "w1",
      conditionObservedAtMs: 1_000,
      transactionSubmittedAtMs: 1_400,
      latencyBudget: { maxLedgers: 1 },
      ledgerCloseMs: 5_000,
    });

    expect(entry.latencyMs).toBe(400);
    expect(entry.ledgerBudget).toBe(1);
    expect(entry.withinBudget).toBe(true);
  });

  it("flags a submission that blew its ledger budget", () => {
    const entry = recordScorecardEntry({
      workerId: "w1",
      conditionObservedAtMs: 0,
      transactionSubmittedAtMs: 11_000,
      latencyBudget: { maxLedgers: 1 },
      ledgerCloseMs: 5_000,
    });

    expect(entry.withinBudget).toBe(false);
  });
});

describe("assertHotPathReady", () => {
  it("always throws for the disabled default tier", () => {
    expect(() => assertHotPathReady(LATENCY_SENSITIVE_TIER_DEFAULT)).toThrow(
      HotPathNotImplementedError,
    );
    expect(() => assertHotPathReady(LATENCY_SENSITIVE_TIER_DEFAULT)).toThrow(/disabled/);
  });

  it("still throws even if a caller claims the tier is enabled - there is no real implementation yet", () => {
    expect(() => assertHotPathReady({ enabled: true })).toThrow(HotPathNotImplementedError);
    expect(() => assertHotPathReady({ enabled: true })).toThrow(/no submitter/);
  });
});
