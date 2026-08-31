import { describe, expect, it } from "vitest";

import {
  BASE_FEE_STROOPS,
  DEFAULT_FEE_MULTIPLIER,
  DEFAULT_MAX_FEE_STROOPS,
  FeeCapExceededError,
  InvalidFeeConfigError,
  MAX_FEE_MULTIPLIER,
  resolveFee,
} from "../src/fees.js";

describe("resolveFee", () => {
  it("pads the simulated resource fee by the default multiplier and adds the base fee", () => {
    const fee = resolveFee("1000");

    expect(fee.simulatedResourceFeeStroops).toBe(1000);
    expect(fee.multiplier).toBe(DEFAULT_FEE_MULTIPLIER);
    expect(fee.resourceFeeStroops).toBe(1500);
    expect(fee.totalStroops).toBe(1500 + BASE_FEE_STROOPS);
  });

  it("rounds a fractional padded fee up, never down", () => {
    // 333 * 1.5 = 499.5 - rounding down would underpay the resource fee.
    expect(resolveFee(333).resourceFeeStroops).toBe(500);
  });

  it("refuses a fee above the configured cap instead of paying it", () => {
    expect(() => resolveFee("1000", { feeMultiplier: 2, maxFeeStroops: 1_500 })).toThrow(
      FeeCapExceededError,
    );

    try {
      resolveFee("1000", { feeMultiplier: 2, maxFeeStroops: 1_500 });
    } catch (error) {
      const capped = error as FeeCapExceededError;
      expect(capped.requestedStroops).toBe(2_100);
      expect(capped.maxFeeStroops).toBe(1_500);
    }
  });

  it("caps by default, so an operator that configures nothing is still bounded", () => {
    expect(DEFAULT_MAX_FEE_STROOPS).toBe(10_000_000);
    expect(() => resolveFee(DEFAULT_MAX_FEE_STROOPS)).toThrow(FeeCapExceededError);
  });

  it("rejects a multiplier above the hard ceiling", () => {
    expect(() => resolveFee("100", { feeMultiplier: MAX_FEE_MULTIPLIER + 1 })).toThrow(
      InvalidFeeConfigError,
    );
  });

  it("rejects a multiplier below 1 - a worker must not underpay simulation", () => {
    expect(() => resolveFee("100", { feeMultiplier: 0.5 })).toThrow(InvalidFeeConfigError);
  });

  it("rejects a non-positive or fractional cap", () => {
    expect(() => resolveFee("100", { maxFeeStroops: 0 })).toThrow(InvalidFeeConfigError);
    expect(() => resolveFee("100", { maxFeeStroops: 10.5 })).toThrow(InvalidFeeConfigError);
  });

  it("rejects an unusable simulated fee rather than signing for NaN", () => {
    expect(() => resolveFee("not-a-number")).toThrow(InvalidFeeConfigError);
    expect(() => resolveFee(-1)).toThrow(InvalidFeeConfigError);
  });
});
