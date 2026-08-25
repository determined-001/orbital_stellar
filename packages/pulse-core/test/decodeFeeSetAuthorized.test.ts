/**
 * decodeFee.ts / decodeSetAuthorized.ts - CAP-67 unified fee/set_authorized
 * event decoder tests.
 *
 * Fixtures (see fixtures/cap67/README.md):
 *  - fee.json: 100-stroop network fee for the transfer_plain transaction
 *  - set_authorized.json: issuer authorizes Alice's trustline
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { decodeUnifiedFee, Cap67FeeDecodeError } from "../src/cap67/decodeFee.js";
import {
  decodeUnifiedSetAuthorized,
  Cap67SetAuthorizedDecodeError,
} from "../src/cap67/decodeSetAuthorized.js";
import type { RawSorobanEvent } from "../src/raw-soroban.js";

const ASSET = "CAP67:GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ALICE = "GAVGVP6NG2YE3XCUZLJ6XTC3MF6SBSX7GSN4RELD4JIIKEP2YK3C3WLF";

function loadFixtureEvent(name: string): RawSorobanEvent {
  const path = fileURLToPath(new URL(`./fixtures/cap67/${name}.json`, import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.result.events[0] as RawSorobanEvent;
}

describe("decodeUnifiedFee", () => {
  it("decodes a fee event", () => {
    const event = loadFixtureEvent("fee");
    expect(decodeUnifiedFee(event)).toEqual({
      from: ALICE,
      amount: 100n,
    });
  });

  it("rejects an event with the wrong topic count", () => {
    const event = loadFixtureEvent("fee");
    const malformed = { ...event, topic: [...event.topic, event.topic[0] as string] };
    expect(() => decodeUnifiedFee(malformed)).toThrow(Cap67FeeDecodeError);
    expect(() => decodeUnifiedFee(malformed)).toThrow(/expected 2 topics, got 3/);
  });

  it("rejects an event whose topic[0] is not the fee symbol", () => {
    const event = loadFixtureEvent("fee");
    const mintSymbolTopic = loadFixtureEvent("mint").topic[0];
    const malformed = { ...event, topic: [mintSymbolTopic, event.topic[1]] };
    expect(() => decodeUnifiedFee(malformed)).toThrow(Cap67FeeDecodeError);
    expect(() => decodeUnifiedFee(malformed)).toThrow(/expected topic\[0\] to be "fee"/);
  });

  it("rejects an event with malformed topic XDR", () => {
    const event = loadFixtureEvent("fee");
    const malformed = { ...event, topic: ["not-valid-base64-xdr!!", event.topic[1]] };
    expect(() => decodeUnifiedFee(malformed)).toThrow(Cap67FeeDecodeError);
  });

  it("rejects an event whose value is not an i128", () => {
    const event = loadFixtureEvent("fee");
    const malformed = { ...event, value: "AAAAAAAAAAE=" };
    expect(() => decodeUnifiedFee(malformed)).toThrow(Cap67FeeDecodeError);
    expect(() => decodeUnifiedFee(malformed)).toThrow(/expected fee value to be an i128/);
  });
});

describe("decodeUnifiedSetAuthorized", () => {
  it("decodes a set_authorized event", () => {
    const event = loadFixtureEvent("set_authorized");
    expect(decodeUnifiedSetAuthorized(event)).toEqual({
      id: ALICE,
      asset: ASSET,
      authorize: true,
    });
  });

  it("rejects an event with the wrong topic count", () => {
    const event = loadFixtureEvent("set_authorized");
    const malformed = { ...event, topic: event.topic.slice(0, 2) };
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(Cap67SetAuthorizedDecodeError);
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(/expected 3 topics, got 2/);
  });

  it("rejects an event whose topic[0] is not the set_authorized symbol", () => {
    const event = loadFixtureEvent("set_authorized");
    const mintSymbolTopic = loadFixtureEvent("mint").topic[0];
    const malformed = { ...event, topic: [mintSymbolTopic, ...event.topic.slice(1)] };
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(Cap67SetAuthorizedDecodeError);
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(
      /expected topic\[0\] to be "set_authorized"/,
    );
  });

  it("rejects an event with malformed topic XDR", () => {
    const event = loadFixtureEvent("set_authorized");
    const malformed = { ...event, topic: ["not-valid-base64-xdr!!", ...event.topic.slice(1)] };
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(Cap67SetAuthorizedDecodeError);
  });

  it("rejects an event whose value is not a bool", () => {
    const event = loadFixtureEvent("set_authorized");
    // "AAAACgAAAAAAAAAAAAAAAAAAAGQ=" is the fee fixture's i128(100) value - not a bool
    const malformed = { ...event, value: "AAAACgAAAAAAAAAAAAAAAAAAAGQ=" };
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(Cap67SetAuthorizedDecodeError);
    expect(() => decodeUnifiedSetAuthorized(malformed)).toThrow(
      /expected set_authorized value to be a bool/,
    );
  });
});
