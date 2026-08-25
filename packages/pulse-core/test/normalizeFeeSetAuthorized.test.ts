/**
 * normalizeFee.ts / normalizeSetAuthorized.ts tests (issue 6.10).
 *
 * `fee` has no Horizon-derived equivalent in this package's taxonomy, so it
 * gets a plain normalization test against the new `fee.incurred` event.
 * `set_authorized` maps onto the existing `trustline.authorized`/
 * `trustline.deauthorized` shape, so its golden-parity test runs the same
 * scenario through both the unified path and `EventEngine`'s real (private)
 * Horizon `normalize()` for an equivalent `set_trust_line_flags` record, and
 * compares the shared fields.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { decodeUnifiedFee } from "../src/cap67/decodeFee.js";
import { normalizeUnifiedFee, Cap67FeeNormalizeError } from "../src/cap67/normalizeFee.js";
import { decodeUnifiedSetAuthorized } from "../src/cap67/decodeSetAuthorized.js";
import {
  normalizeUnifiedSetAuthorized,
  Cap67SetAuthorizedNormalizeError,
} from "../src/cap67/normalizeSetAuthorized.js";
import { toContractAddress } from "../src/address.js";
import type { UnifiedFee } from "../src/cap67/decodeFee.js";
import type { UnifiedSetAuthorized } from "../src/cap67/decodeSetAuthorized.js";
import type { RawSorobanEvent } from "../src/raw-soroban.js";

const ASSET = "CAP67:GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ISSUER = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ALICE = "GAVGVP6NG2YE3XCUZLJ6XTC3MF6SBSX7GSN4RELD4JIIKEP2YK3C3WLF";

function loadFixtureEvent(name: string): RawSorobanEvent {
  const path = fileURLToPath(new URL(`./fixtures/cap67/${name}.json`, import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.result.events[0] as RawSorobanEvent;
}

describe("normalizeUnifiedFee", () => {
  it("maps onto the fee.incurred taxonomy event", () => {
    const fee: UnifiedFee = { from: ALICE as never, amount: 100n };
    const event = normalizeUnifiedFee(fee, "2026-01-01T00:00:00Z");

    expect(event).toMatchObject({
      type: "fee.incurred",
      from: ALICE,
      amount: "0.0000100",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(event.timestampDate).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("rejects a contract-address payer", () => {
    const fee: UnifiedFee = {
      from: toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2"),
      amount: 1n,
    };
    expect(() => normalizeUnifiedFee(fee, "2026-01-01T00:00:00Z")).toThrow(Cap67FeeNormalizeError);
  });

  it("decode + normalize pipeline against the live fee.json fixture", () => {
    const raw = loadFixtureEvent("fee");
    const event = normalizeUnifiedFee(decodeUnifiedFee(raw), raw.ledgerClosedAt);

    expect(event).toMatchObject({
      type: "fee.incurred",
      from: ALICE,
      amount: "0.0000100",
      timestamp: raw.ledgerClosedAt,
    });
  });
});

describe("normalizeUnifiedSetAuthorized", () => {
  it("maps onto trustline.authorized, matching the equivalent Horizon set_trust_line_flags shape (golden parity)", () => {
    const raw = loadFixtureEvent("set_authorized");
    const unified = normalizeUnifiedSetAuthorized(
      decodeUnifiedSetAuthorized(raw),
      raw.ledgerClosedAt,
    );

    const engine = new EventEngine({ network: "testnet" });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): {
          trustor: unknown;
          issuer: unknown;
          asset: unknown;
          timestamp: unknown;
          type: unknown;
        };
      }
    ).normalize.bind(engine);
    const horizon = normalize({
      type: "set_trust_line_flags",
      trustor: ALICE,
      source_account: ISSUER,
      set_flags_s: ["authorized"],
      asset_type: "credit_alphanum12",
      asset_code: "CAP67",
      asset_issuer: ISSUER,
      created_at: raw.ledgerClosedAt,
    });

    expect({
      trustor: unified.trustor,
      issuer: unified.issuer,
      asset: unified.asset,
      timestamp: unified.timestamp,
    }).toEqual({
      trustor: horizon.trustor,
      issuer: horizon.issuer,
      asset: horizon.asset,
      timestamp: horizon.timestamp,
    });

    expect(unified.type).toBe(horizon.type);
    expect(unified.type).toBe("trustline.authorized");
  });

  it("maps onto trustline.deauthorized when authorize is false", () => {
    const setAuthorized: UnifiedSetAuthorized = {
      id: ALICE as never,
      asset: ASSET,
      authorize: false,
    };
    const event = normalizeUnifiedSetAuthorized(setAuthorized, "2026-01-01T00:00:00Z");
    expect(event.type).toBe("trustline.deauthorized");
  });

  it("rejects a muxed or contract trustor", () => {
    const setAuthorized: UnifiedSetAuthorized = {
      id: toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2"),
      asset: ASSET,
      authorize: true,
    };
    expect(() => normalizeUnifiedSetAuthorized(setAuthorized, "2026-01-01T00:00:00Z")).toThrow(
      Cap67SetAuthorizedNormalizeError,
    );
  });
});
