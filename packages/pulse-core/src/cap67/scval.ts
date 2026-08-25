/**
 * Shared ScVal decoding helpers for CAP-67 unified event decoders.
 */
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  isAccountAddress,
  isContractAddress,
  isMuxedAddress,
  toAccountAddress,
  toContractAddress,
  toMuxedAddress,
} from "../address.js";
import type { StellarAddress } from "../address.js";
import type { RawSorobanEvent } from "../raw-soroban.js";

export function decodeTopicScVal(
  topic: string,
  index: number,
  makeError: (reason: string) => Error,
): xdr.ScVal {
  try {
    return xdr.ScVal.fromXDR(topic, "base64");
  } catch (cause) {
    throw makeError(`malformed topic[${index}] XDR: ${String(cause)}`);
  }
}

export function decodeAddressTopic(
  scVal: xdr.ScVal,
  index: number,
  makeError: (reason: string) => Error,
): StellarAddress {
  let address: string;
  try {
    address = Address.fromScVal(scVal).toString();
  } catch (cause) {
    throw makeError(`topic[${index}] is not a valid address: ${String(cause)}`);
  }
  if (isAccountAddress(address)) return toAccountAddress(address);
  if (isMuxedAddress(address)) return toMuxedAddress(address);
  if (isContractAddress(address)) return toContractAddress(address);
  throw makeError(`topic[${index}] address "${address}" has an unrecognized form`);
}

export function decodeI128(
  scVal: xdr.ScVal,
  context: string,
  makeError: (reason: string) => Error,
): bigint {
  if (scVal.switch() !== xdr.ScValType.scvI128()) {
    throw makeError(`expected ${context} to be an i128, got ${scVal.switch().name}`);
  }
  const native = scValToNative(scVal);
  if (typeof native !== "bigint") {
    throw makeError(`expected ${context} to decode to a bigint, got ${typeof native}`);
  }
  return native;
}

/** Decodes topic `index` as a Symbol and asserts it equals `expectedSymbol`. */
export function decodeSymbolTopic(
  topic: string,
  index: number,
  expectedSymbol: string,
  makeError: (reason: string) => Error,
): void {
  const scVal = decodeTopicScVal(topic, index, makeError);
  let symbol: unknown;
  try {
    symbol = scValToNative(scVal);
  } catch (cause) {
    throw makeError(`malformed topic[${index}] symbol: ${String(cause)}`);
  }
  if (symbol !== expectedSymbol) {
    throw makeError(
      `expected topic[${index}] to be "${expectedSymbol}", got ${JSON.stringify(symbol)}`,
    );
  }
}

/** Decodes topic `index` as a plain string (e.g. an asset in `CODE:ISSUER` form). */
export function decodeStringTopic(
  topic: string,
  index: number,
  makeError: (reason: string) => Error,
): string {
  const scVal = decodeTopicScVal(topic, index, makeError);
  let value: unknown;
  try {
    value = scValToNative(scVal);
  } catch (cause) {
    throw makeError(`malformed topic[${index}]: ${String(cause)}`);
  }
  if (typeof value !== "string") {
    throw makeError(`expected topic[${index}] to be a string, got ${typeof value}`);
  }
  return value;
}

/** Decodes a raw event's `value` field (base64 XDR) into an `xdr.ScVal`. */
export function decodeEventValueScVal(
  event: Pick<RawSorobanEvent, "value">,
  makeError: (reason: string) => Error,
): xdr.ScVal {
  if (typeof event.value !== "string") {
    throw makeError("expected event value to be a base64 XDR string");
  }
  try {
    return xdr.ScVal.fromXDR(event.value, "base64");
  } catch (cause) {
    throw makeError(`malformed value XDR: ${String(cause)}`);
  }
}

export function decodeBool(
  scVal: xdr.ScVal,
  context: string,
  makeError: (reason: string) => Error,
): boolean {
  if (scVal.switch() !== xdr.ScValType.scvBool()) {
    throw makeError(`expected ${context} to be a bool, got ${scVal.switch().name}`);
  }
  const native = scValToNative(scVal);
  if (typeof native !== "boolean") {
    throw makeError(`expected ${context} to decode to a boolean, got ${typeof native}`);
  }
  return native;
}

/** Typed result of decoding a CAP-67 event shaped `[symbol, address, asset]` with an `i128` value. */
export interface SingleAddressAssetEvent {
  address: StellarAddress;
  asset: string;
  amount: bigint;
}

/**
 * Decodes the common shape shared by CAP-67 `mint`, `burn`, and `clawback`
 * events: three topics (`[symbol, address, asset]`) and a bare `i128` value.
 * Post-CAP-67, none of these three carry an admin topic.
 */
export function decodeSingleAddressAssetEvent(
  event: Pick<RawSorobanEvent, "topic" | "value">,
  expectedSymbol: string,
  makeError: (reason: string) => Error,
): SingleAddressAssetEvent {
  if (event.topic.length !== 3) {
    throw makeError(`expected 3 topics, got ${event.topic.length}`);
  }

  const [symbolTopic, addressTopic, assetTopic] = event.topic as [string, string, string];

  const symbolScVal = decodeTopicScVal(symbolTopic, 0, makeError);
  let symbol: unknown;
  try {
    symbol = scValToNative(symbolScVal);
  } catch (cause) {
    throw makeError(`malformed topic[0] symbol: ${String(cause)}`);
  }
  if (symbol !== expectedSymbol) {
    throw makeError(`expected topic[0] to be "${expectedSymbol}", got ${JSON.stringify(symbol)}`);
  }

  const address = decodeAddressTopic(decodeTopicScVal(addressTopic, 1, makeError), 1, makeError);

  const assetScVal = decodeTopicScVal(assetTopic, 2, makeError);
  let asset: unknown;
  try {
    asset = scValToNative(assetScVal);
  } catch (cause) {
    throw makeError(`malformed topic[2] asset: ${String(cause)}`);
  }
  if (typeof asset !== "string") {
    throw makeError(`expected topic[2] asset to be a string, got ${typeof asset}`);
  }

  if (typeof event.value !== "string") {
    throw makeError("expected event value to be a base64 XDR string");
  }

  let valueScVal: xdr.ScVal;
  try {
    valueScVal = xdr.ScVal.fromXDR(event.value, "base64");
  } catch (cause) {
    throw makeError(`malformed value XDR: ${String(cause)}`);
  }

  const amount = decodeI128(valueScVal, `${expectedSymbol} value`, makeError);

  return { address, asset, amount };
}
