import { describe, it, expect } from "vitest";
import { toBigInt } from "../src/amount.js";

describe("amount.toBigInt", () => {
  it("converts simple decimals to stroops", () => {
    expect(toBigInt("1.2345678" as any)).toBe(12345678n);
    expect(toBigInt("0.0000001" as any)).toBe(1n);
    expect(toBigInt("2" as any)).toBe(20000000n);
    expect(toBigInt("-2.5" as any)).toBe(-25000000n);
  });

  it("truncates extra fractional precision", () => {
    // 1.00000009 -> fractional part truncated to 7 digits -> 1.0000000
    expect(toBigInt("1.00000009" as any)).toBe(10000000n);
  });

  it("throws on malformed input", () => {
    expect(() => toBigInt("abc" as any)).toThrow();
    expect(() => toBigInt("1.2.3" as any)).toThrow();
    expect(() => toBigInt("" as any)).toThrow();
  });
});