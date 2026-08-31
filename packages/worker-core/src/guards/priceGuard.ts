/**
 * Off-chain price guard rails (issue #1072, "22.5 Slippage and oracle guard
 * rails"). Trade automation reads prices, and a price source is an attack
 * surface: a manipulated or stale reading must not become a vault action.
 *
 * These guards are the ones *in front of* the vault's slippage bound (its
 * last line of defence), not a replacement for it - see
 * `docs/design/worker-guard-rails.md` for the full on-chain/off-chain split.
 * Everything in this file runs before a worker ever builds a transaction; it
 * has no dependency on the vault contract existing.
 */

/**
 * A single price reading. Fixed-point (`price` scaled by `decimals`), not a
 * `number`, because float arithmetic on financial comparisons is exactly the
 * kind of subtle bug this guard exists to prevent - a floating-point rounding
 * difference must never be the reason a manipulated price slips past a
 * divergence check. Matches how Reflector (§C.8) reports prices: an integer
 * mantissa plus a fixed decimal count per asset.
 */
export interface PriceReading {
  /** Fixed-point price mantissa. */
  price: bigint;
  /** Decimal places `price` is scaled by (Reflector uses 14 for most feeds). */
  decimals: number;
  /** Unix seconds the reading's own timestamp claims. */
  observedAtUnix: number;
  /** Human-readable source id, e.g. `"reflector:CEX"`, `"reflector:DEX"`. */
  source: string;
}

export interface StalenessBound {
  /** A reading older than this, or timestamped in the future, is rejected. */
  maxAgeSeconds: number;
}

export interface DeviationBound {
  /** Maximum allowed divergence between two sources, in basis points. */
  maxDivergenceBps: number;
}

export interface PriceGuardConfig {
  staleness: StalenessBound;
  deviation: DeviationBound;
}

interface GuardOk {
  ok: true;
}

interface StaleVerdict {
  ok: false;
  reason: "stale";
  source: string;
  ageSeconds: number;
  bound: StalenessBound;
}

interface DivergingVerdict {
  ok: false;
  reason: "diverging";
  divergenceBps: number;
  bound: DeviationBound;
  readings: [PriceReading, PriceReading];
}

export type PriceGuardVerdict = GuardOk | StaleVerdict | DivergingVerdict;

/**
 * Rejects a reading that is older than `bound.maxAgeSeconds`, and rejects a
 * reading timestamped in the future - a reading that claims to be from later
 * than "now" says more about clock skew or a malformed source than about the
 * price, and treating it as fresh would let a source manufacture staleness
 * immunity by lying about its timestamp.
 */
export function checkStaleness(
  reading: PriceReading,
  bound: StalenessBound,
  nowUnix: number,
): PriceGuardVerdict {
  const ageSeconds = nowUnix - reading.observedAtUnix;
  if (ageSeconds < 0 || ageSeconds > bound.maxAgeSeconds) {
    return { ok: false, reason: "stale", source: reading.source, ageSeconds, bound };
  }
  return { ok: true };
}

/** Scales a reading's mantissa to `targetDecimals` so two readings can be compared. */
function scaleTo(reading: PriceReading, targetDecimals: number): bigint {
  const diff = targetDecimals - reading.decimals;
  if (diff === 0) return reading.price;
  if (diff > 0) return reading.price * 10n ** BigInt(diff);
  return reading.price / 10n ** BigInt(-diff);
}

/**
 * Compares two independently-sourced readings and rejects the pair if they
 * diverge past `bound.maxDivergenceBps`. This is the deviation check: a
 * single manipulated source cannot pass it alone, because the guard only
 * ever evaluates a source *relative to* a second, independent one (§C.8 -
 * avoiding a single-source dependency is the point, not an implementation
 * detail).
 *
 * Divergence is computed against the smaller of the two normalized prices,
 * so it is symmetric under which reading is "primary" - `checkDeviation(a,
 * b, bound)` and `checkDeviation(b, a, bound)` agree.
 */
export function checkDeviation(
  a: PriceReading,
  b: PriceReading,
  bound: DeviationBound,
): PriceGuardVerdict {
  const targetDecimals = Math.max(a.decimals, b.decimals);
  const scaledA = scaleTo(a, targetDecimals);
  const scaledB = scaleTo(b, targetDecimals);

  if (scaledA <= 0n || scaledB <= 0n) {
    // A non-positive price is not a valid market price under any source -
    // treat it as maximally diverging rather than dividing by a
    // non-positive number.
    return {
      ok: false,
      reason: "diverging",
      divergenceBps: Number.POSITIVE_INFINITY,
      bound,
      readings: [a, b],
    };
  }

  const diff = scaledA > scaledB ? scaledA - scaledB : scaledB - scaledA;
  const smaller = scaledA < scaledB ? scaledA : scaledB;
  // basis points = diff / smaller * 10_000, kept in bigint until the final
  // division so a large mantissa never loses precision to an intermediate
  // float.
  const divergenceBpsExact = (diff * 10_000n) / smaller;
  const divergenceBps = Number(divergenceBpsExact);

  if (divergenceBpsExact > BigInt(bound.maxDivergenceBps)) {
    return { ok: false, reason: "diverging", divergenceBps, bound, readings: [a, b] };
  }
  return { ok: true };
}

/**
 * Runs both guards in the order that matters operationally: a stale reading
 * is rejected before its value is compared to anything, since a stale value
 * is meaningless regardless of how well it happens to agree with a second
 * source. Both readings must pass staleness before deviation is checked.
 */
export function checkPriceGuard(
  primary: PriceReading,
  secondary: PriceReading,
  config: PriceGuardConfig,
  nowUnix: number,
): PriceGuardVerdict {
  const primaryStaleness = checkStaleness(primary, config.staleness, nowUnix);
  if (!primaryStaleness.ok) return primaryStaleness;

  const secondaryStaleness = checkStaleness(secondary, config.staleness, nowUnix);
  if (!secondaryStaleness.ok) return secondaryStaleness;

  return checkDeviation(primary, secondary, config.deviation);
}
