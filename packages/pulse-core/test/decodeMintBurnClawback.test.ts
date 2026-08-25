/**
 * decodeMint.ts / decodeBurn.ts / decodeClawback.ts - CAP-67 unified
 * mint/burn/clawback event decoder tests.
 *
 * Fixtures (see fixtures/cap67/README.md):
 *  - mint.json: issuer pays Alice 1000 CAP67
 *  - burn.json: Bob pays the issuer 10 CAP67
 *  - clawback.json: issuer claws back 50 CAP67 from Alice
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { decodeUnifiedMint, Cap67MintDecodeError } from "../src/cap67/decodeMint.js";
import { decodeUnifiedBurn, Cap67BurnDecodeError } from "../src/cap67/decodeBurn.js";
import { decodeUnifiedClawback, Cap67ClawbackDecodeError } from "../src/cap67/decodeClawback.js";
import type { RawSorobanEvent } from "../src/raw-soroban.js";

const ASSET = "CAP67:GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ALICE = "GAVGVP6NG2YE3XCUZLJ6XTC3MF6SBSX7GSN4RELD4JIIKEP2YK3C3WLF";
const BOB = "GD6USNRQFJHMFL3KY56F6BKG4N2EXVCQLTXAQ3NGJUVNZ5T3K4XZU4IX";

function loadFixtureEvent(name: string): RawSorobanEvent {
  const path = fileURLToPath(new URL(`./fixtures/cap67/${name}.json`, import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.result.events[0] as RawSorobanEvent;
}

describe("decodeUnifiedMint", () => {
  it("decodes a mint event", () => {
    const event = loadFixtureEvent("mint");
    expect(decodeUnifiedMint(event)).toEqual({
      to: ALICE,
      asset: ASSET,
      amount: 10000000000n,
    });
  });

  it("rejects an event with the wrong topic count", () => {
    const event = loadFixtureEvent("mint");
    const malformed = { ...event, topic: event.topic.slice(0, 2) };
    expect(() => decodeUnifiedMint(malformed)).toThrow(Cap67MintDecodeError);
    expect(() => decodeUnifiedMint(malformed)).toThrow(/expected 3 topics, got 2/);
  });

  it("rejects an event whose topic[0] is not the mint symbol", () => {
    const event = loadFixtureEvent("mint");
    const burnSymbolTopic = loadFixtureEvent("burn").topic[0];
    const malformed = { ...event, topic: [burnSymbolTopic, ...event.topic.slice(1)] };
    expect(() => decodeUnifiedMint(malformed)).toThrow(Cap67MintDecodeError);
    expect(() => decodeUnifiedMint(malformed)).toThrow(/expected topic\[0\] to be "mint"/);
  });

  it("rejects an event with malformed topic XDR", () => {
    const event = loadFixtureEvent("mint");
    const malformed = { ...event, topic: ["not-valid-base64-xdr!!", ...event.topic.slice(1)] };
    expect(() => decodeUnifiedMint(malformed)).toThrow(Cap67MintDecodeError);
  });

  it("rejects an event whose value is not an i128", () => {
    const event = loadFixtureEvent("mint");
    const malformed = { ...event, value: "AAAAAAAAAAE=" };
    expect(() => decodeUnifiedMint(malformed)).toThrow(Cap67MintDecodeError);
    expect(() => decodeUnifiedMint(malformed)).toThrow(/expected mint value to be an i128/);
  });
});

describe("decodeUnifiedBurn", () => {
  it("decodes a burn event", () => {
    const event = loadFixtureEvent("burn");
    expect(decodeUnifiedBurn(event)).toEqual({
      from: BOB,
      asset: ASSET,
      amount: 100000000n,
    });
  });

  it("rejects an event with the wrong topic count", () => {
    const event = loadFixtureEvent("burn");
    const malformed = { ...event, topic: event.topic.slice(0, 2) };
    expect(() => decodeUnifiedBurn(malformed)).toThrow(Cap67BurnDecodeError);
    expect(() => decodeUnifiedBurn(malformed)).toThrow(/expected 3 topics, got 2/);
  });

  it("rejects an event whose topic[0] is not the burn symbol", () => {
    const event = loadFixtureEvent("burn");
    const mintSymbolTopic = loadFixtureEvent("mint").topic[0];
    const malformed = { ...event, topic: [mintSymbolTopic, ...event.topic.slice(1)] };
    expect(() => decodeUnifiedBurn(malformed)).toThrow(Cap67BurnDecodeError);
    expect(() => decodeUnifiedBurn(malformed)).toThrow(/expected topic\[0\] to be "burn"/);
  });

  it("rejects an event with malformed topic XDR", () => {
    const event = loadFixtureEvent("burn");
    const malformed = { ...event, topic: ["not-valid-base64-xdr!!", ...event.topic.slice(1)] };
    expect(() => decodeUnifiedBurn(malformed)).toThrow(Cap67BurnDecodeError);
  });
});

describe("decodeUnifiedClawback", () => {
  it("decodes a clawback event", () => {
    const event = loadFixtureEvent("clawback");
    expect(decodeUnifiedClawback(event)).toEqual({
      from: ALICE,
      asset: ASSET,
      amount: 500000000n,
    });
  });

  it("rejects an event with the wrong topic count", () => {
    const event = loadFixtureEvent("clawback");
    const malformed = { ...event, topic: event.topic.slice(0, 2) };
    expect(() => decodeUnifiedClawback(malformed)).toThrow(Cap67ClawbackDecodeError);
    expect(() => decodeUnifiedClawback(malformed)).toThrow(/expected 3 topics, got 2/);
  });

  it("rejects an event whose topic[0] is not the clawback symbol", () => {
    const event = loadFixtureEvent("clawback");
    const mintSymbolTopic = loadFixtureEvent("mint").topic[0];
    const malformed = { ...event, topic: [mintSymbolTopic, ...event.topic.slice(1)] };
    expect(() => decodeUnifiedClawback(malformed)).toThrow(Cap67ClawbackDecodeError);
    expect(() => decodeUnifiedClawback(malformed)).toThrow(/expected topic\[0\] to be "clawback"/);
  });

  it("rejects an event with malformed topic XDR", () => {
    const event = loadFixtureEvent("clawback");
    const malformed = { ...event, topic: ["not-valid-base64-xdr!!", ...event.topic.slice(1)] };
    expect(() => decodeUnifiedClawback(malformed)).toThrow(Cap67ClawbackDecodeError);
  });
});
