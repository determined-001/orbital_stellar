/**
 * normalizeMint.ts / normalizeBurn.ts / normalizeClawback.ts tests.
 *
 * Golden parity: mint/burn map onto the same `payment.received`/`payment.sent`
 * shape Horizon's `_normalize()` produces for a classic payment op (see
 * EventEngine.ts `_normalize`, `r.type === "payment"` branch) - only the
 * `raw` transport field differs, which parity tests exclude. Clawback has no
 * Horizon-derived equivalent in this package, so it gets a plain
 * normalization test against the new `asset.clawback` taxonomy entry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { normalizeUnifiedMint, Cap67MintNormalizeError } from "../src/cap67/normalizeMint.js";
import { normalizeUnifiedBurn, Cap67BurnNormalizeError } from "../src/cap67/normalizeBurn.js";
import {
  normalizeUnifiedClawback,
  Cap67ClawbackNormalizeError,
} from "../src/cap67/normalizeClawback.js";
import { decodeUnifiedMint } from "../src/cap67/decodeMint.js";
import { decodeUnifiedBurn } from "../src/cap67/decodeBurn.js";
import { decodeUnifiedClawback } from "../src/cap67/decodeClawback.js";
import { toAccountAddress, toContractAddress } from "../src/address.js";
import type { UnifiedMint } from "../src/cap67/decodeMint.js";
import type { UnifiedBurn } from "../src/cap67/decodeBurn.js";
import type { UnifiedClawback } from "../src/cap67/decodeClawback.js";
import type { RawSorobanEvent } from "../src/raw-soroban.js";

function loadFixtureEvent(name: string): RawSorobanEvent {
  const path = fileURLToPath(new URL(`./fixtures/cap67/${name}.json`, import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.result.events[0] as RawSorobanEvent;
}

const ASSET = "CAP67:GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ISSUER = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ALICE = "GAVGVP6NG2YE3XCUZLJ6XTC3MF6SBSX7GSN4RELD4JIIKEP2YK3C3WLF";
const BOB = "GD6USNRQFJHMFL3KY56F6BKG4N2EXVCQLTXAQ3NGJUVNZ5T3K4XZU4IX";
const LEDGER_CLOSED_AT = "2026-07-20T17:01:32Z";

describe("normalizeUnifiedMint", () => {
  it("maps onto payment.received, matching the Horizon payment shape (minus transport metadata)", () => {
    const mint: UnifiedMint = { to: toAccountAddress(ALICE), asset: ASSET, amount: 10000000000n };
    const event = normalizeUnifiedMint(mint, LEDGER_CLOSED_AT);

    expect(event).toMatchObject({
      type: "payment.received",
      to: ALICE,
      from: ISSUER,
      amount: "1000.0000000",
      asset: ASSET,
      timestamp: LEDGER_CLOSED_AT,
    });
    expect(event.raw).toBeUndefined();
    expect(event.timestampDate).toEqual(new Date(LEDGER_CLOSED_AT));
  });

  it("rejects a contract-address recipient", () => {
    const mint: UnifiedMint = {
      to: toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2"),
      asset: ASSET,
      amount: 1n,
    };
    expect(() => normalizeUnifiedMint(mint, LEDGER_CLOSED_AT)).toThrow(Cap67MintNormalizeError);
  });

  it("rejects an asset not in CODE:ISSUER form", () => {
    const mint: UnifiedMint = { to: toAccountAddress(ALICE), asset: "native", amount: 1n };
    expect(() => normalizeUnifiedMint(mint, LEDGER_CLOSED_AT)).toThrow(Cap67MintNormalizeError);
  });
});

describe("normalizeUnifiedBurn", () => {
  it("maps onto payment.sent, matching the Horizon payment shape (minus transport metadata)", () => {
    const burn: UnifiedBurn = { from: toAccountAddress(BOB), asset: ASSET, amount: 100000000n };
    const event = normalizeUnifiedBurn(burn, LEDGER_CLOSED_AT);

    expect(event).toMatchObject({
      type: "payment.sent",
      to: ISSUER,
      from: BOB,
      amount: "10.0000000",
      asset: ASSET,
      timestamp: LEDGER_CLOSED_AT,
    });
    expect(event.raw).toBeUndefined();
  });

  it("rejects a contract-address source", () => {
    const burn: UnifiedBurn = {
      from: toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2"),
      asset: ASSET,
      amount: 1n,
    };
    expect(() => normalizeUnifiedBurn(burn, LEDGER_CLOSED_AT)).toThrow(Cap67BurnNormalizeError);
  });
});

describe("normalizeUnifiedClawback", () => {
  it("maps onto the asset.clawback taxonomy event", () => {
    const clawback: UnifiedClawback = {
      from: toAccountAddress(ALICE),
      asset: ASSET,
      amount: 500000000n,
    };
    const event = normalizeUnifiedClawback(clawback, LEDGER_CLOSED_AT);

    expect(event).toMatchObject({
      type: "asset.clawback",
      from: ALICE,
      asset: ASSET,
      amount: "50.0000000",
      timestamp: LEDGER_CLOSED_AT,
    });
    expect(event.timestampDate).toEqual(new Date(LEDGER_CLOSED_AT));
  });

  it("rejects a contract-address source", () => {
    const clawback: UnifiedClawback = {
      from: toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2"),
      asset: ASSET,
      amount: 1n,
    };
    expect(() => normalizeUnifiedClawback(clawback, LEDGER_CLOSED_AT)).toThrow(
      Cap67ClawbackNormalizeError,
    );
  });
});

describe("decode + normalize pipeline against live fixtures", () => {
  it("mint.json normalizes to payment.received", () => {
    const raw = loadFixtureEvent("mint");
    const event = normalizeUnifiedMint(decodeUnifiedMint(raw), raw.ledgerClosedAt);

    expect(event).toMatchObject({
      type: "payment.received",
      to: ALICE,
      from: ISSUER,
      amount: "1000.0000000",
      asset: ASSET,
      timestamp: raw.ledgerClosedAt,
    });
  });

  it("burn.json normalizes to payment.sent", () => {
    const raw = loadFixtureEvent("burn");
    const event = normalizeUnifiedBurn(decodeUnifiedBurn(raw), raw.ledgerClosedAt);

    expect(event).toMatchObject({
      type: "payment.sent",
      to: ISSUER,
      from: BOB,
      amount: "10.0000000",
      asset: ASSET,
      timestamp: raw.ledgerClosedAt,
    });
  });

  it("clawback.json normalizes to asset.clawback", () => {
    const raw = loadFixtureEvent("clawback");
    const event = normalizeUnifiedClawback(decodeUnifiedClawback(raw), raw.ledgerClosedAt);

    expect(event).toMatchObject({
      type: "asset.clawback",
      from: ALICE,
      asset: ASSET,
      amount: "50.0000000",
      timestamp: raw.ledgerClosedAt,
    });
  });
});
