import { describe, it, expect } from "vitest";
import { toBigInt, fromBigInt } from "../src/amount.js";
import type { StellarAmount } from "../src/amount.js";

describe("amount.toBigInt", () => {
  it("converts simple decimals to stroops", () => {
    expect(toBigInt("1.2345678" as any)).toBe(12345678n);
    expect(toBigInt("0.0000001" as any)).toBe(1n);
    expect(toBigInt("2" as any)).toBe(20000000n);
    expect(toBigInt("-2.5" as any)).toBe(-25000000n);

    const amount = "1.2345678" as StellarAmount;
    expect(toBigInt(amount)).toBe(12345678n);
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

describe("amount.fromBigInt", () => {
  it("converts stroops to a fixed 7-decimal string", () => {
    expect(fromBigInt(10000000000n)).toBe("1000.0000000");
    expect(fromBigInt(12345678n)).toBe("1.2345678");
    expect(fromBigInt(1n)).toBe("0.0000001");
    expect(fromBigInt(0n)).toBe("0.0000000");
  });

  it("handles negative amounts", () => {
    expect(fromBigInt(-25000000n)).toBe("-2.5000000");
  });

  it("round-trips through toBigInt", () => {
    const amount = "1000.0000000" as StellarAmount;
    expect(fromBigInt(toBigInt(amount))).toBe(amount);
  });
});
