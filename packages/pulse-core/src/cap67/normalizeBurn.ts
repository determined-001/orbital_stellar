/**
 * Normalizer for decoded CAP-67 `burn` events.
 *
 * Burn is the unified-stream equivalent of a classic Horizon payment whose
 * destination is the asset issuer, so it maps onto the same `payment.sent`
 * taxonomy shape Horizon produces for that payment - the sender's view is
 * identical regardless of which transport delivered the event.
 */
import { fromBigInt } from "../amount.js";
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { PaymentEvent } from "../index.js";
import type { UnifiedBurn } from "./decodeBurn.js";
import { issuerFromAsset, toPaymentAddress } from "./normalizeAssetEvent.js";

/** Thrown when a decoded CAP-67 `burn` event cannot be mapped onto `PaymentEvent`. */
export class Cap67BurnNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 burn event: ${reason}`);
    this.name = "Cap67BurnNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedBurn} onto a `payment.sent`
 * {@link PaymentEvent}.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67BurnNormalizeError} if the source is a contract address
 *   (unrepresentable as a payment counterparty) or the asset is not in
 *   `CODE:ISSUER` form.
 */
export function normalizeUnifiedBurn(
  burn: UnifiedBurn,
  ledgerClosedAt: string,
): Timestamped<PaymentEvent> {
  const makeError = (reason: string) => new Cap67BurnNormalizeError(reason);

  const event: Omit<PaymentEvent, "timestampDate"> = {
    type: "payment.sent",
    to: issuerFromAsset(burn.asset, makeError),
    from: toPaymentAddress(burn.from, makeError),
    amount: fromBigInt(burn.amount),
    asset: burn.asset,
    timestamp: ledgerClosedAt,
  };

  return withTimestampDate(event);
}
