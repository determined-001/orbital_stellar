/**
 * Normalizer for decoded CAP-67 `fee` events.
 *
 * Fee is new in CAP-67 - there is no Horizon-derived equivalent in this
 * package's current taxonomy (fees were previously only derivable
 * implicitly from transaction metadata), so it maps onto its own
 * `fee.incurred` event rather than an existing payment shape.
 */
import { fromBigInt } from "../amount.js";
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { FeeIncurredEvent } from "../index.js";
import type { UnifiedFee } from "./decodeFee.js";
import { toPaymentAddress } from "./normalizeAssetEvent.js";

/** Thrown when a decoded CAP-67 `fee` event cannot be mapped onto `FeeIncurredEvent`. */
export class Cap67FeeNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 fee event: ${reason}`);
    this.name = "Cap67FeeNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedFee} onto a `fee.incurred`
 * {@link FeeIncurredEvent}.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67FeeNormalizeError} if the payer is a contract address, which
 *   this taxonomy event cannot represent.
 */
export function normalizeUnifiedFee(
  fee: UnifiedFee,
  ledgerClosedAt: string,
): Timestamped<FeeIncurredEvent> {
  const makeError = (reason: string) => new Cap67FeeNormalizeError(reason);

  const event: Omit<FeeIncurredEvent, "timestampDate"> = {
    type: "fee.incurred",
    from: toPaymentAddress(fee.from, makeError),
    amount: fromBigInt(fee.amount),
    timestamp: ledgerClosedAt,
  };

  return withTimestampDate(event);
}
