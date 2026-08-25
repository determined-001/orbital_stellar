/**
 * Normalizer for decoded CAP-67 `transfer` events.
 *
 * Unlike mint/burn (where the SAC issuer gives an unambiguous "received"/
 * "sent" narrative), a plain transfer between two ordinary accounts is
 * symmetric - it's simultaneously a "sent" event from the source's
 * perspective and a "received" event from the destination's. Resolving
 * that per watcher is what Horizon's own engine does at dispatch time
 * (`EventEngine`'s private pending-event pattern), which is out of scope
 * here. This normalizer instead always returns the sender's perspective
 * (`type: "payment.sent"`) as the single canonical output, except for a
 * self-transfer (`from === to`), which is unambiguous and maps onto
 * `"payment.self"` exactly like Horizon's own normalization does.
 */
import { fromBigInt } from "../amount.js";
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { PaymentEvent } from "../index.js";
import type { UnifiedTransfer } from "./decodeTransfer.js";
import { toPaymentAddress } from "./normalizeAssetEvent.js";

const NATIVE_ASSET = "native";

/** Thrown when a decoded CAP-67 `transfer` event cannot be mapped onto `PaymentEvent`. */
export class Cap67TransferNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 transfer event: ${reason}`);
    this.name = "Cap67TransferNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedTransfer} onto a `payment.sent`
 * (or `payment.self`, for a self-transfer) {@link PaymentEvent}, matching
 * the shape Horizon produces for the equivalent classic payment - same
 * `"XLM"` native-asset spelling, and the transaction memo (when present)
 * carried through to `PaymentEvent.memo`.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67TransferNormalizeError} if either address is a contract
 *   address (unrepresentable as a payment counterparty).
 */
export function normalizeUnifiedTransfer(
  transfer: UnifiedTransfer,
  ledgerClosedAt: string,
): Timestamped<PaymentEvent> {
  const makeError = (reason: string) => new Cap67TransferNormalizeError(reason);

  const to = toPaymentAddress(transfer.to, makeError);
  const from = toPaymentAddress(transfer.from, makeError);
  const asset = transfer.asset === NATIVE_ASSET ? "XLM" : transfer.asset;

  const event: Omit<PaymentEvent, "timestampDate"> = {
    type: from === to ? "payment.self" : "payment.sent",
    to,
    from,
    amount: fromBigInt(transfer.amount),
    asset,
    timestamp: ledgerClosedAt,
    ...(transfer.memo !== undefined ? { memo: transfer.memo } : {}),
  };

  return withTimestampDate(event);
}
