import { describe, expect, it } from "vitest";
import type { Sep24Status, Sep31Status } from "@orbital-stellar/pulse-core";
import {
  normalizeSep24Transaction,
  normalizeSep31Status,
  sep24Stage,
  sep31Stage,
  type Sep24Transaction,
} from "../src/index.js";

const ANCHOR_URL = "https://anchor.example.com/sep24";

function transaction(overrides: Partial<Sep24Transaction> = {}): Sep24Transaction {
  return {
    id: "tx-1",
    kind: "deposit",
    status: "completed",
    amount_in: "100.0000000",
    amount_out: "99.0000000",
    amount_fee: "1.0000000",
    updated_at: "2026-08-02T10:00:00Z",
    ...overrides,
  } as Sep24Transaction;
}

describe("anchor taxonomy mapping (#929)", () => {
  it("maps a completed deposit onto anchor.deposit.completed", () => {
    const event = normalizeSep24Transaction(transaction(), { anchorUrl: ANCHOR_URL });

    expect(event.type).toBe("anchor.deposit.completed");
    expect(event.stage).toBe("completed");
    expect(event.protocol).toBe("sep24");
    expect(event.transactionId).toBe("tx-1");
    expect(event.anchorUrl).toBe(ANCHOR_URL);
    expect(event.amountIn).toBe("100.0000000");
    expect(event.timestamp).toBe("2026-08-02T10:00:00Z");
  });

  it("maps withdrawals onto the withdrawal family", () => {
    const event = normalizeSep24Transaction(
      transaction({ kind: "withdrawal", status: "pending_user_transfer_start" }),
      { anchorUrl: ANCHOR_URL },
    );

    expect(event.type).toBe("anchor.withdrawal.pending");
  });

  it("preserves the anchor's own status verbatim alongside the normalized type", () => {
    const event = normalizeSep24Transaction(transaction({ status: "pending_trust" }), {
      anchorUrl: ANCHOR_URL,
    });

    // The normalization is lossy by design; protocolStatus is not.
    expect(event.type).toBe("anchor.deposit.pending");
    expect(event.protocolStatus).toBe("pending_trust");
  });

  it("carries the settlement hash when the anchor published one", () => {
    const event = normalizeSep24Transaction(transaction({ stellar_transaction_id: "abc123" }), {
      anchorUrl: ANCHOR_URL,
    });

    expect(event.settlementTxHash).toBe("abc123");
  });

  it("reports settlementTxHash as null - never inferred - when the anchor omits it", () => {
    const event = normalizeSep24Transaction(transaction(), { anchorUrl: ANCHOR_URL });

    expect(event.settlementTxHash).toBeNull();
    // Explicitly present, so a consumer can tell "no hash" from "not modelled".
    expect("settlementTxHash" in event).toBe(true);
  });

  it("maps every SEP-24 status to exactly one stage", () => {
    const statuses: Sep24Status[] = [
      "incomplete",
      "pending_user_transfer_start",
      "pending_user_transfer_complete",
      "pending_external",
      "pending_anchor",
      "pending_stellar",
      "pending_trust",
      "pending_user",
      "completed",
      "refunded",
      "expired",
      "no_market",
      "too_small",
      "too_large",
      "error",
    ];

    for (const status of statuses) {
      expect(["initiated", "pending", "completed", "refunded", "failed"]).toContain(
        sep24Stage(status),
      );
    }

    expect(sep24Stage("refunded")).toBe("refunded");
    expect(sep24Stage("too_large")).toBe("failed");
  });

  it("maps SEP-31 statuses onto anchor.payment.*", () => {
    const statuses: Sep31Status[] = [
      "pending_sender",
      "pending_transaction_info_update",
      "pending_stellar",
      "pending_receiver",
      "pending_external",
      "completed",
      "error",
    ];

    for (const status of statuses) {
      const event = normalizeSep31Status(status, {
        anchorUrl: ANCHOR_URL,
        transactionId: "sep31-1",
      });
      expect(event.type.startsWith("anchor.payment.")).toBe(true);
      expect(event.protocol).toBe("sep31");
      expect(event.stage).toBe(sep31Stage(status));
      expect(event.settlementTxHash).toBeNull();
    }

    expect(
      normalizeSep31Status("completed", {
        anchorUrl: ANCHOR_URL,
        transactionId: "sep31-1",
        stellarTransactionId: "hash-9",
      }).settlementTxHash,
    ).toBe("hash-9");
  });

  it("exposes a lazy, non-enumerable timestampDate like pulse-core's own events", () => {
    const event = normalizeSep24Transaction(transaction(), { anchorUrl: ANCHOR_URL });

    expect(event.timestampDate).toBeInstanceOf(Date);
    expect(event.timestampDate.toISOString()).toBe("2026-08-02T10:00:00.000Z");
    // Cached: the same instance on every access.
    expect(event.timestampDate).toBe(event.timestampDate);
    expect(Object.keys(JSON.parse(JSON.stringify(event)))).not.toContain("timestampDate");
  });
});
