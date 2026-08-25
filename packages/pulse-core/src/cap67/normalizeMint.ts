/**
 * Normalizer for decoded CAP-67 `mint` events.
 *
 * Mint is the unified-stream equivalent of a classic Horizon payment whose
 * source is the asset issuer, so it maps onto the same `payment.received`
 * taxonomy shape Horizon produces for that payment - the recipient's view is
 * identical regardless of which transport delivered the event.
 */
import { fromBigInt } from "../amount.js";
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { PaymentEvent } from "../index.js";
import type { UnifiedMint } from "./decodeMint.js";
import { issuerFromAsset, toPaymentAddress } from "./normalizeAssetEvent.js";

/** Thrown when a decoded CAP-67 `mint` event cannot be mapped onto `PaymentEvent`. */
export class Cap67MintNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 mint event: ${reason}`);
    this.name = "Cap67MintNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedMint} onto a `payment.received`
 * {@link PaymentEvent}.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67MintNormalizeError} if the recipient is a contract address
 *   (unrepresentable as a payment counterparty) or the asset is not in
 *   `CODE:ISSUER` form.
 */
export function normalizeUnifiedMint(
  mint: UnifiedMint,
  ledgerClosedAt: string,
): Timestamped<PaymentEvent> {
  const makeError = (reason: string) => new Cap67MintNormalizeError(reason);

  const event: Omit<PaymentEvent, "timestampDate"> = {
    type: "payment.received",
    to: toPaymentAddress(mint.to, makeError),
    from: issuerFromAsset(mint.asset, makeError),
    amount: fromBigInt(mint.amount),
    asset: mint.asset,
    timestamp: ledgerClosedAt,
  };

  return withTimestampDate(event);
}
