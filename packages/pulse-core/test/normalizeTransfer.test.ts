/**
 * normalizeTransfer.ts tests (issue 6.8).
 *
 * Golden parity: the shared to/from/amount/asset/timestamp fields must be
 * identical whether the transfer is normalized from the unified stream or
 * from an equivalent Horizon payment record - proven here by running the
 * *same* scenario through both `normalizeUnifiedTransfer` and
 * `EventEngine`'s real (private) Horizon `normalize()`, then comparing.
 * `type` itself isn't compared: Horizon's engine defers direction
 * resolution to per-watcher dispatch (`type: "unknown"`, private to
 * `EventEngine`), while this normalizer resolves a single canonical
 * `"payment.sent"` (or `"payment.self"`) perspective, documented in
 * `normalizeTransfer.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import {
  normalizeUnifiedTransfer,
  Cap67TransferNormalizeError,
} from "../src/cap67/normalizeTransfer.js";
import { decodeUnifiedTransfer } from "../src/cap67/decodeTransfer.js";
import { toContractAddress } from "../src/address.js";
import type { UnifiedTransfer } from "../src/cap67/decodeTransfer.js";
import type { RawSorobanEvent } from "../src/raw-soroban.js";

const ASSET = "CAP67:GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const ALICE = "GAVGVP6NG2YE3XCUZLJ6XTC3MF6SBSX7GSN4RELD4JIIKEP2YK3C3WLF";
const BOB = "GD6USNRQFJHMFL3KY56F6BKG4N2EXVCQLTXAQ3NGJUVNZ5T3K4XZU4IX";

function loadFixtureEvent(name: string): RawSorobanEvent {
  const path = fileURLToPath(new URL(`./fixtures/cap67/${name}.json`, import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.result.events[0] as RawSorobanEvent;
}

function normalizeHorizonPayment(record: unknown): {
  to: unknown;
  from: unknown;
  amount: unknown;
  asset: unknown;
  timestamp: unknown;
} {
  const engine = new EventEngine({ network: "testnet" });
  const normalize = (
    engine as unknown as {
      normalize(record: unknown): {
        to: unknown;
        from: unknown;
        amount: unknown;
        asset: unknown;
        timestamp: unknown;
      };
    }
  ).normalize.bind(engine);
  return normalize(record);
}

describe("normalizeUnifiedTransfer", () => {
  it("matches the equivalent Horizon-normalized payment's shared fields (golden parity, plain form)", () => {
    const raw = loadFixtureEvent("transfer_plain");
    const unified = normalizeUnifiedTransfer(decodeUnifiedTransfer(raw), raw.ledgerClosedAt);

    const horizon = normalizeHorizonPayment({
      type: "payment",
      to: BOB,
      from: ALICE,
      amount: "100.0000000",
      asset_type: "credit_alphanum12",
      asset_code: "CAP67",
      asset_issuer: "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7",
      created_at: raw.ledgerClosedAt,
    });

    expect({
      to: unified.to,
      from: unified.from,
      amount: unified.amount,
      asset: unified.asset,
      timestamp: unified.timestamp,
    }).toEqual({
      to: horizon.to,
      from: horizon.from,
      amount: horizon.amount,
      asset: horizon.asset,
      timestamp: horizon.timestamp,
    });

    expect(unified.type).toBe("payment.sent");
    expect(unified.memo).toBeUndefined();
  });

  it("propagates the transaction memo from the map-based data form", () => {
    const raw = loadFixtureEvent("transfer_memo");
    const unified = normalizeUnifiedTransfer(decodeUnifiedTransfer(raw), raw.ledgerClosedAt);

    expect(unified).toMatchObject({
      type: "payment.sent",
      to: BOB,
      from: ALICE,
      amount: "25.0000000",
      asset: ASSET,
      memo: "orbital-cap67-fixture",
    });
  });

  it("normalizes a native-asset transfer's asset string to XLM, matching Horizon", () => {
    const transfer: UnifiedTransfer = {
      from: ALICE as never,
      to: BOB as never,
      asset: "native",
      amount: 10000000n,
    };
    const event = normalizeUnifiedTransfer(transfer, "2026-01-01T00:00:00Z");
    expect(event.asset).toBe("XLM");
  });

  it("resolves to payment.self for a self-transfer, matching Horizon's special case", () => {
    const transfer: UnifiedTransfer = {
      from: ALICE as never,
      to: ALICE as never,
      asset: ASSET,
      amount: 1n,
    };
    const event = normalizeUnifiedTransfer(transfer, "2026-01-01T00:00:00Z");
    expect(event.type).toBe("payment.self");
  });

  it("rejects a contract-address counterparty", () => {
    const contract = toContractAddress("CBJMXTF5BAV7MOFPIUEYXY6DTTNQYUESII3XM4FTVACYNIDB7QPPUDF2");
    const transfer: UnifiedTransfer = {
      from: ALICE as never,
      to: contract,
      asset: ASSET,
      amount: 1n,
    };
    expect(() => normalizeUnifiedTransfer(transfer, "2026-01-01T00:00:00Z")).toThrow(
      Cap67TransferNormalizeError,
    );
  });
});
