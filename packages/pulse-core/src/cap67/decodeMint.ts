/**
 * Decoder for CAP-67 unified `mint` events.
 *
 * Protocol 23's CAP-67 has the SAC emit `mint` (topics `["mint", to, asset]`,
 * a bare `i128` amount value) instead of `transfer` when the issuer is the
 * source of a classic payment. Unlike pre-CAP-67 mint events, there is no
 * admin topic.
 */
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import { decodeSingleAddressAssetEvent } from "./scval.js";

const MINT_TOPIC_SYMBOL = "mint";

/** Typed intermediate result of decoding a CAP-67 `mint` event. */
export interface UnifiedMint {
  /** The account, muxed account, or contract that received the newly minted asset. */
  to: StellarAddress;
  /** The asset in `CODE:ISSUER` form. */
  asset: string;
  /** The minted amount, in stroops (raw `i128`, unscaled). */
  amount: bigint;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `mint` event shape. */
export class Cap67MintDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 mint event: ${reason}`);
    this.name = "Cap67MintDecodeError";
  }
}

/**
 * Decodes a raw CAP-67 unified `mint` event into a typed {@link UnifiedMint}.
 *
 * @throws {Cap67MintDecodeError} if `event` is not a well-formed CAP-67
 *   `mint` event (wrong topic count/kind, malformed XDR, or a non-i128 value).
 */
export function decodeUnifiedMint(event: Pick<RawSorobanEvent, "topic" | "value">): UnifiedMint {
  const { address, asset, amount } = decodeSingleAddressAssetEvent(
    event,
    MINT_TOPIC_SYMBOL,
    (reason) => new Cap67MintDecodeError(reason),
  );
  return { to: address, asset, amount };
}
