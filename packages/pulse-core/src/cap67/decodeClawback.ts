/**
 * Decoder for CAP-67 unified `clawback` events.
 *
 * Protocol 23's CAP-67 has the SAC emit `clawback` (topics
 * `["clawback", from, asset]`, a bare `i128` amount value) when the issuer
 * claws back a held balance. Unlike pre-CAP-67 clawback events, there is no
 * admin topic.
 */
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import { decodeSingleAddressAssetEvent } from "./scval.js";

const CLAWBACK_TOPIC_SYMBOL = "clawback";

/** Typed intermediate result of decoding a CAP-67 `clawback` event. */
export interface UnifiedClawback {
  /** The account, muxed account, or contract the asset was clawed back from. */
  from: StellarAddress;
  /** The asset in `CODE:ISSUER` form. */
  asset: string;
  /** The clawed-back amount, in stroops (raw `i128`, unscaled). */
  amount: bigint;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `clawback` event shape. */
export class Cap67ClawbackDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 clawback event: ${reason}`);
    this.name = "Cap67ClawbackDecodeError";
  }
}

/**
 * Decodes a raw CAP-67 unified `clawback` event into a typed
 * {@link UnifiedClawback}.
 *
 * @throws {Cap67ClawbackDecodeError} if `event` is not a well-formed CAP-67
 *   `clawback` event (wrong topic count/kind, malformed XDR, or a non-i128
 *   value).
 */
export function decodeUnifiedClawback(
  event: Pick<RawSorobanEvent, "topic" | "value">,
): UnifiedClawback {
  const { address, asset, amount } = decodeSingleAddressAssetEvent(
    event,
    CLAWBACK_TOPIC_SYMBOL,
    (reason) => new Cap67ClawbackDecodeError(reason),
  );
  return { from: address, asset, amount };
}
