export type StellarAmount = string & { __brand: "StellarAmount" };

/**
 * Brand a raw amount string as a {@link StellarAmount}. This is the canonical
 * way normalizers attach the brand to values coming off Horizon/RPC records.
 */
export function toStellarAmount(s: string): StellarAmount {
  return s as StellarAmount;
}

/**
 * Convert a Stellar decimal amount string (e.g. "1.2345678") into
 * stroop-precision integer (amount * 10^7) as a bigint.
 *
 * Rules:
 * - Accepts optional leading `-` for negative amounts.
 * - Pads fractional part to 7 digits; truncates extra precision (no rounding).
 * - Throws on malformed numeric input.
 */
export function toBigInt(amount: StellarAmount): bigint {
  const s = amount as unknown as string;
  if (typeof s !== "string") throw new Error("Invalid StellarAmount");
  const negative = s.startsWith("-");
  const abs = negative ? s.slice(1) : s;
  if (abs === "") throw new Error("Invalid StellarAmount");

  const parts = abs.split(".");
  if (parts.length > 2) throw new Error("Invalid StellarAmount");
  const whole = parts[0] || "0";
  const frac = parts[1] ?? "";

  if (!/^\d+$/.test(whole) || (frac !== "" && !/^\d+$/.test(frac))) {
    throw new Error("Invalid StellarAmount");
  }

  const padded = (frac + "0000000").slice(0, 7);
  const wholeBig = BigInt(whole);
  const fracBig = BigInt(padded);
  const combined = wholeBig * 10000000n + fracBig;
  return negative ? -combined : combined;
}
