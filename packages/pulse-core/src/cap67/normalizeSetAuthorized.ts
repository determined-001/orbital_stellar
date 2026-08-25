/**
 * Normalizer for decoded CAP-67 `set_authorized` events.
 *
 * `set_authorized` is the unified-stream equivalent of classic
 * `allow_trust`/`set_trust_line_flags` operations, so it maps onto the same
 * `trustline.authorized`/`trustline.deauthorized` taxonomy shape Horizon
 * produces for those - consumers see an identical event regardless of
 * transport.
 */
import { withTimestampDate } from "../timestampDate.js";
import type { Timestamped } from "../timestampDate.js";
import type { TrustAuthEvent } from "../index.js";
import type { UnifiedSetAuthorized } from "./decodeSetAuthorized.js";
import { issuerFromAsset, toAccountOnlyAddress } from "./normalizeAssetEvent.js";

/** Thrown when a decoded CAP-67 `set_authorized` event cannot be mapped onto `TrustAuthEvent`. */
export class Cap67SetAuthorizedNormalizeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to normalize CAP-67 set_authorized event: ${reason}`);
    this.name = "Cap67SetAuthorizedNormalizeError";
  }
}

/**
 * Maps a decoded CAP-67 {@link UnifiedSetAuthorized} onto a
 * `trustline.authorized` (or `trustline.deauthorized`) {@link TrustAuthEvent},
 * matching the shape Horizon produces for the equivalent
 * `allow_trust`/`set_trust_line_flags` operation.
 *
 * @param ledgerClosedAt ISO 8601 close time of the ledger the event was
 *   emitted in (`RawSorobanEvent.ledgerClosedAt`), used as the event timestamp.
 * @throws {Cap67SetAuthorizedNormalizeError} if the trustor is a muxed or
 *   contract address (Horizon's own taxonomy requires a plain account here
 *   too), or the asset is not in `CODE:ISSUER` form.
 */
export function normalizeUnifiedSetAuthorized(
  setAuthorized: UnifiedSetAuthorized,
  ledgerClosedAt: string,
): Timestamped<TrustAuthEvent> {
  const makeError = (reason: string) => new Cap67SetAuthorizedNormalizeError(reason);

  const event: Omit<TrustAuthEvent, "timestampDate"> = {
    type: setAuthorized.authorize ? "trustline.authorized" : "trustline.deauthorized",
    trustor: toAccountOnlyAddress(setAuthorized.id, makeError),
    issuer: issuerFromAsset(setAuthorized.asset, makeError),
    asset: setAuthorized.asset,
    timestamp: ledgerClosedAt,
    operation: "set_authorized",
  };

  return withTimestampDate(event);
}
