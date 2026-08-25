/**
 * Decoder for CAP-67 unified `burn` events.
 *
 * Protocol 23's CAP-67 has the SAC emit `burn` (topics `["burn", from, asset]`,
 * a bare `i128` amount value) instead of `transfer` when the issuer is the
 * destination of a classic payment. Unlike pre-CAP-67 burn events, there is
 * no admin topic.
 */
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import { decodeSingleAddressAssetEvent } from "./scval.js";

const BURN_TOPIC_SYMBOL = "burn";

/** Typed intermediate result of decoding a CAP-67 `burn` event. */
export interface UnifiedBurn {
  /** The account, muxed account, or contract whose asset was burned. */
  from: StellarAddress;
  /** The asset in `CODE:ISSUER` form. */
  asset: string;
  /** The burned amount, in stroops (raw `i128`, unscaled). */
  amount: bigint;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `burn` event shape. */
export class Cap67BurnDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 burn event: ${reason}`);
    this.name = "Cap67BurnDecodeError";
  }
}

/**
 * Decodes a raw CAP-67 unified `burn` event into a typed {@link UnifiedBurn}.
 *
 * @throws {Cap67BurnDecodeError} if `event` is not a well-formed CAP-67
 *   `burn` event (wrong topic count/kind, malformed XDR, or a non-i128 value).
 */
export function decodeUnifiedBurn(event: Pick<RawSorobanEvent, "topic" | "value">): UnifiedBurn {
  const { address, asset, amount } = decodeSingleAddressAssetEvent(
    event,
    BURN_TOPIC_SYMBOL,
    (reason) => new Cap67BurnDecodeError(reason),
  );
  return { from: address, asset, amount };
}
