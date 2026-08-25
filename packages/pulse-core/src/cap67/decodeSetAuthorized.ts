/**
 * Decoder for CAP-67 unified `set_authorized` events.
 *
 * Protocol 23's CAP-67 has the SAC emit `set_authorized` (topics
 * `["set_authorized", id, asset]`, a bare `bool` value) when the issuer
 * changes a trustline's authorization flag - the unified-stream equivalent
 * of classic `allow_trust`/`set_trust_line_flags` operations. Unlike
 * pre-CAP-67 events, there is no admin topic.
 */
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import {
  decodeAddressTopic,
  decodeBool,
  decodeEventValueScVal,
  decodeStringTopic,
  decodeSymbolTopic,
  decodeTopicScVal,
} from "./scval.js";

const SET_AUTHORIZED_TOPIC_SYMBOL = "set_authorized";

/** Typed intermediate result of decoding a CAP-67 `set_authorized` event. */
export interface UnifiedSetAuthorized {
  /** The account, muxed account, or contract whose trustline authorization changed. */
  id: StellarAddress;
  /** The asset in `CODE:ISSUER` form. */
  asset: string;
  /** Whether the trustline is now authorized (`true`) or deauthorized (`false`). */
  authorize: boolean;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `set_authorized` event shape. */
export class Cap67SetAuthorizedDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 set_authorized event: ${reason}`);
    this.name = "Cap67SetAuthorizedDecodeError";
  }
}

/**
 * Decodes a raw CAP-67 unified `set_authorized` event into a typed
 * {@link UnifiedSetAuthorized}.
 *
 * @throws {Cap67SetAuthorizedDecodeError} if `event` is not a well-formed
 *   CAP-67 `set_authorized` event (wrong topic count/kind, malformed XDR,
 *   or a non-bool value).
 */
export function decodeUnifiedSetAuthorized(
  event: Pick<RawSorobanEvent, "topic" | "value">,
): UnifiedSetAuthorized {
  const makeError = (reason: string) => new Cap67SetAuthorizedDecodeError(reason);

  if (event.topic.length !== 3) {
    throw makeError(`expected 3 topics, got ${event.topic.length}`);
  }
  const [symbolTopic, idTopic, assetTopic] = event.topic as [string, string, string];

  decodeSymbolTopic(symbolTopic, 0, SET_AUTHORIZED_TOPIC_SYMBOL, makeError);
  const id = decodeAddressTopic(decodeTopicScVal(idTopic, 1, makeError), 1, makeError);
  const asset = decodeStringTopic(assetTopic, 2, makeError);

  const valueScVal = decodeEventValueScVal(event, makeError);
  const authorize = decodeBool(valueScVal, "set_authorized value", makeError);

  return { id, asset, authorize };
}
