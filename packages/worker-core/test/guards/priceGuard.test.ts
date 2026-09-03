import { describe, it, expect } from "vitest";
import {
  checkStaleness,
  checkDeviation,
  checkPriceGuard,
  type PriceReading,
} from "../../src/guards/priceGuard.js";

const NOW = 1_800_000_000;

function reading(overrides: Partial<PriceReading> = {}): PriceReading {
  return {
    price: 100_000_000_000_000n, // 1.00000000000000 at 14 decimals
    decimals: 14,
    observedAtUnix: NOW,
    source: "reflector:CEX",
    ...overrides,
  };
}

describe("checkStaleness", () => {
  it("passes a fresh reading", () => {
    const verdict = checkStaleness(reading(), { maxAgeSeconds: 30 }, NOW);
    expect(verdict.ok).toBe(true);
  });

  it("passes a reading exactly at the staleness bound", () => {
    const verdict = checkStaleness(
      reading({ observedAtUnix: NOW - 30 }),
      { maxAgeSeconds: 30 },
      NOW,
    );
    expect(verdict.ok).toBe(true);
  });

  it("rejects a stale reading", () => {
    const verdict = checkStaleness(
      reading({ observedAtUnix: NOW - 31 }),
      { maxAgeSeconds: 30 },
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("stale");
    expect(verdict.ageSeconds).toBe(31);
  });

  it("rejects a reading timestamped in the future rather than treating it as fresher-than-fresh", () => {
    const verdict = checkStaleness(
      reading({ observedAtUnix: NOW + 5 }),
      { maxAgeSeconds: 30 },
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("stale");
    expect(verdict.ageSeconds).toBe(-5);
  });
});

describe("checkDeviation", () => {
  it("passes two sources in close agreement", () => {
    const a = reading({ source: "reflector:CEX", price: 100_000_000_000_000n });
    const b = reading({ source: "reflector:DEX", price: 100_050_000_000_000n }); // +5bps
    const verdict = checkDeviation(a, b, { maxDivergenceBps: 50 });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a manipulated price diverging past the bound", () => {
    const honest = reading({ source: "reflector:CEX", price: 100_000_000_000_000n });
    // A manipulated feed reporting 10% above the honest source - the exact
    // shape of an oracle-manipulation attack the deviation check exists for.
    const manipulated = reading({ source: "compromised-dex", price: 110_000_000_000_000n });

    const verdict = checkDeviation(honest, manipulated, { maxDivergenceBps: 100 });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("diverging");
    expect(verdict.divergenceBps).toBeGreaterThan(100);
  });

  it("is symmetric regardless of argument order", () => {
    const a = reading({ price: 100_000_000_000_000n });
    const b = reading({ price: 110_000_000_000_000n });
    const bound = { maxDivergenceBps: 100 };

    const ab = checkDeviation(a, b, bound);
    const ba = checkDeviation(b, a, bound);
    expect(ab.ok).toBe(false);
    expect(ba.ok).toBe(false);
    if (ab.ok || ba.ok) return;
    expect(ab.divergenceBps).toBe(ba.divergenceBps);
  });

  it("normalizes mismatched decimals before comparing", () => {
    const a = reading({ price: 100_000_000_000_000n, decimals: 14 }); // 1.0
    const b = reading({ price: 1_000_000n, decimals: 6 }); // also 1.0, different scale
    const verdict = checkDeviation(a, b, { maxDivergenceBps: 1 });
    expect(verdict.ok).toBe(true);
  });

  it("treats a non-positive price as maximally diverging rather than dividing by zero", () => {
    const a = reading({ price: 100_000_000_000_000n });
    const zero = reading({ price: 0n });
    const verdict = checkDeviation(a, zero, { maxDivergenceBps: 100 });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.divergenceBps).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("checkPriceGuard", () => {
  const config = { staleness: { maxAgeSeconds: 30 }, deviation: { maxDivergenceBps: 100 } };

  it("passes two fresh, agreeing sources", () => {
    const primary = reading({ source: "reflector:CEX" });
    const secondary = reading({ source: "reflector:DEX", price: 100_050_000_000_000n });
    expect(checkPriceGuard(primary, secondary, config, NOW).ok).toBe(true);
  });

  it("skips the action on a stale primary reading, before even checking deviation", () => {
    const stalePrimary = reading({ observedAtUnix: NOW - 60 });
    const secondary = reading();
    const verdict = checkPriceGuard(stalePrimary, secondary, config, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("stale");
  });

  it("skips the action on a stale secondary reading", () => {
    const primary = reading();
    const staleSecondary = reading({ observedAtUnix: NOW - 60 });
    const verdict = checkPriceGuard(primary, staleSecondary, config, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("stale");
  });

  it("skips the action when both readings are fresh but diverge", () => {
    const primary = reading({ price: 100_000_000_000_000n });
    const manipulated = reading({ price: 110_000_000_000_000n, source: "compromised-dex" });
    const verdict = checkPriceGuard(primary, manipulated, config, NOW);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("diverging");
  });
});
