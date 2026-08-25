/**
 * Decoder for CAP-67 unified `transfer` events.
 *
 * Protocol 23's CAP-67 makes classic asset transfers emit a Soroban-format
 * contract event with topics `["transfer", from, to, asset]` and a data
 * payload that is either a bare `i128` amount, or - when the originating
 * transaction carried a memo - an `SCMap` with `amount` and `to_muxed_id`
 * entries. This module decodes either form into a single typed struct.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";
import { decodeAddressTopic, decodeI128, decodeTopicScVal } from "./scval.js";

const TRANSFER_TOPIC_SYMBOL = "transfer";
const AMOUNT_MAP_KEY = "amount";
const MEMO_MAP_KEY = "to_muxed_id";

/** Typed intermediate result of decoding a CAP-67 `transfer` event. */
export interface UnifiedTransfer {
  /** The account, muxed account, or contract that sent the asset. */
  from: StellarAddress;
  /** The account, muxed account, or contract that received the asset. */
  to: StellarAddress;
  /** The asset in `CODE:ISSUER` form (or `"native"` for XLM). */
  asset: string;
  /** The transferred amount, in stroops (raw `i128`, unscaled). */
  amount: bigint;
  /**
   * The `to_muxed_id` memo carried alongside the amount when the originating
   * transaction had a memo. Only present for the map-based data form.
   */
  memo?: string;
}

/** Thrown when a raw Soroban event does not match the CAP-67 `transfer` event shape. */
export class Cap67TransferDecodeError extends Error {
  constructor(reason: string) {
    super(`[pulse-core] failed to decode CAP-67 transfer event: ${reason}`);
    this.name = "Cap67TransferDecodeError";
  }
}

const makeError = (reason: string) => new Cap67TransferDecodeError(reason);

function decodeTransferValue(scVal: xdr.ScVal): { amount: bigint; memo?: string } {
  switch (scVal.switch()) {
    case xdr.ScValType.scvI128():
      return { amount: decodeI128(scVal, "transfer value", makeError) };

    case xdr.ScValType.scvMap(): {
      const map = scVal.map();
      if (!map) {
        throw new Cap67TransferDecodeError("transfer value map is null");
      }

      let amount: bigint | undefined;
      let memo: string | undefined;

      for (const entry of map) {
        let key: unknown;
        try {
          key = scValToNative(entry.key());
        } catch (cause) {
          throw new Cap67TransferDecodeError(`malformed map entry key: ${String(cause)}`);
        }

        if (key === AMOUNT_MAP_KEY) {
          amount = decodeI128(entry.val(), `"${AMOUNT_MAP_KEY}" map entry`, makeError);
        } else if (key === MEMO_MAP_KEY) {
          let memoVal: unknown;
          try {
            memoVal = scValToNative(entry.val());
          } catch (cause) {
            throw new Cap67TransferDecodeError(
              `malformed "${MEMO_MAP_KEY}" map entry: ${String(cause)}`,
            );
          }
          if (typeof memoVal !== "string") {
            throw new Cap67TransferDecodeError(
              `expected "${MEMO_MAP_KEY}" map entry to be a string, got ${typeof memoVal}`,
            );
          }
          memo = memoVal;
        }
      }

      if (amount === undefined) {
        throw new Cap67TransferDecodeError(
          `transfer value map is missing a required "${AMOUNT_MAP_KEY}" entry`,
        );
      }

      return memo === undefined ? { amount } : { amount, memo };
    }

    default:
      throw new Cap67TransferDecodeError(
        `unsupported transfer value shape (expected i128 or map, got ${scVal.switch().name})`,
      );
  }
}

/**
 * Decodes a raw CAP-67 unified `transfer` event into a typed
 * {@link UnifiedTransfer}. Accepts either data form: a bare `i128` amount, or
 * an `SCMap` carrying `amount` alongside a `to_muxed_id` memo.
 *
 * @throws {Cap67TransferDecodeError} if `event` is not a well-formed CAP-67
 *   `transfer` event (wrong topic count/kind, malformed XDR, or an
 *   unrecognized value shape).
 */
export function decodeUnifiedTransfer(
  event: Pick<RawSorobanEvent, "topic" | "value">,
): UnifiedTransfer {
  if (event.topic.length !== 4) {
    throw new Cap67TransferDecodeError(`expected 4 topics, got ${event.topic.length}`);
  }

  const [symbolTopic, fromTopic, toTopic, assetTopic] = event.topic as [
    string,
    string,
    string,
    string,
  ];

  const symbolScVal = decodeTopicScVal(symbolTopic, 0, makeError);
  let symbol: unknown;
  try {
    symbol = scValToNative(symbolScVal);
  } catch (cause) {
    throw new Cap67TransferDecodeError(`malformed topic[0] symbol: ${String(cause)}`);
  }
  if (symbol !== TRANSFER_TOPIC_SYMBOL) {
    throw new Cap67TransferDecodeError(
      `expected topic[0] to be "${TRANSFER_TOPIC_SYMBOL}", got ${JSON.stringify(symbol)}`,
    );
  }

  const from = decodeAddressTopic(decodeTopicScVal(fromTopic, 1, makeError), 1, makeError);
  const to = decodeAddressTopic(decodeTopicScVal(toTopic, 2, makeError), 2, makeError);

  const assetScVal = decodeTopicScVal(assetTopic, 3, makeError);
  let asset: unknown;
  try {
    asset = scValToNative(assetScVal);
  } catch (cause) {
    throw new Cap67TransferDecodeError(`malformed topic[3] asset: ${String(cause)}`);
  }
  if (typeof asset !== "string") {
    throw new Cap67TransferDecodeError(
      `expected topic[3] asset to be a string, got ${typeof asset}`,
    );
  }

  if (typeof event.value !== "string") {
    throw new Cap67TransferDecodeError("expected event value to be a base64 XDR string");
  }

  let valueScVal: xdr.ScVal;
  try {
    valueScVal = xdr.ScVal.fromXDR(event.value, "base64");
  } catch (cause) {
    throw new Cap67TransferDecodeError(`malformed value XDR: ${String(cause)}`);
  }

  const { amount, memo } = decodeTransferValue(valueScVal);

  return memo === undefined ? { from, to, asset, amount } : { from, to, asset, amount, memo };
}
