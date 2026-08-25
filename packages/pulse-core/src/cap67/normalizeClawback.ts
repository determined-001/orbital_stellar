/**
 * Normalizer for decoded CAP-67 `clawback` events.
 *
 * Clawback has no Horizon-derived equivalent in this package's current
 * taxonomy (no `RawHorizonClawback`/normalizer exists), so it maps onto its
 * own `asset.clawback` event rather than an existing payment shape.
 */
import { fromBigInt } from "../amount.js";
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { AssetClawbackEvent } from "../index.js";
import type { UnifiedClawback } from "./decodeClawback.js";
import { toPaymentAddress } from "./normalizeAssetEvent.js";

/** Thrown when a decoded CAP-67 `clawback` event cannot be mapped onto `AssetClawbackEvent`. */
export class Cap67ClawbackNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 clawback event: ${reason}`);
    this.name = "Cap67ClawbackNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedClawback} onto an `asset.clawback`
 * {@link AssetClawbackEvent}.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67ClawbackNormalizeError} if the source is a contract address,
 *   which this taxonomy event cannot represent.
 */
export function normalizeUnifiedClawback(
  clawback: UnifiedClawback,
  ledgerClosedAt: string,
): Timestamped<AssetClawbackEvent> {
  const makeError = (reason: string) => new Cap67ClawbackNormalizeError(reason);

  const event: Omit<AssetClawbackEvent, "timestampDate"> = {
    type: "asset.clawback",
    from: toPaymentAddress(clawback.from, makeError),
    asset: clawback.asset,
    amount: fromBigInt(clawback.amount),
    timestamp: ledgerClosedAt,
  };

  return withTimestampDate(event);
}
