/**
 * Decoder for CAP-67 unified `fee` events.
 *
 * Protocol 23's CAP-67 introduces an explicit `fee` event (topics
 * `["fee", from]`, a bare `i128` amount value) emitted by a shared
 * fee-event system contract whenever a classic transaction pays a network
 * fee - previously only derivable implicitly from transaction metadata.
 * Fees are always paid in native XLM, so unlike `mint`/`burn`/`clawback`
 * there is no asset topic.
 */
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import {
  decodeAddressTopic,
  decodeEventValueScVal,
  decodeI128,
  decodeSymbolTopic,
  decodeTopicScVal,
} from "./scval.js";

const FEE_TOPIC_SYMBOL = "fee";

/** Typed intermediate result of decoding a CAP-67 `fee` event. */
export interface UnifiedFee {
  /** The account, muxed account, or contract that paid the fee. */
  from: StellarAddress;
  /** The fee amount, in stroops (raw `i128`, unscaled). */
  amount: bigint;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `fee` event shape. */
export class Cap67FeeDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 fee event: ${reason}`);
    this.name = "Cap67FeeDecodeError";
  }
}

/**
 * Decodes a raw CAP-67 unified `fee` event into a typed {@link UnifiedFee}.
 *
 * @throws {Cap67FeeDecodeError} if `event` is not a well-formed CAP-67 `fee`
 *   event (wrong topic count/kind, malformed XDR, or a non-i128 value).
 */
export function decodeUnifiedFee(event: Pick<RawSorobanEvent, "topic" | "value">): UnifiedFee {
  const makeError = (reason: string) => new Cap67FeeDecodeError(reason);

  if (event.topic.length !== 2) {
    throw makeError(`expected 2 topics, got ${event.topic.length}`);
  }
  const [symbolTopic, fromTopic] = event.topic as [string, string];

  decodeSymbolTopic(symbolTopic, 0, FEE_TOPIC_SYMBOL, makeError);
  const from = decodeAddressTopic(decodeTopicScVal(fromTopic, 1, makeError), 1, makeError);

  const valueScVal = decodeEventValueScVal(event, makeError);
  const amount = decodeI128(valueScVal, "fee value", makeError);

  return { from, amount };
}
