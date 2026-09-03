import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import type { NormalizedEvent } from "../src/index.js";
import { deriveDedupeKey, DedupeWindow } from "../src/dedupe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Harness = {
  engine: EventEngine;
  simulateRecord: (record: unknown) => void;
  joinCalls: string[];
};

function buildEngine(): Harness {
  const engine = new EventEngine({ network: "testnet", abiRegistry: false });
  const joinCalls: string[] = [];

  let capturedOnMessage: ((record: unknown) => void) | null = null;

  vi.spyOn((engine as any).server, "operations").mockImplementation(() => ({
    join(include: string) {
      joinCalls.push(include);
      return this;
    },
    cursor: () => ({
      stream: (callbacks: { onmessage: (r: unknown) => void }) => {
        capturedOnMessage = callbacks.onmessage;
        return () => {};
      },
    }),
  }));

  engine.start();

  return {
    engine,
    joinCalls,
    simulateRecord: (record) => {
      if (!capturedOnMessage) throw new Error("Stream not opened");
      capturedOnMessage(record);
    },
  };
}

/** A Horizon payment operation with the transaction joined onto it. */
function paymentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "payment",
    to: "GDEST",
    from: "GSRC",
    amount: "12.5000000",
    asset_type: "native",
    created_at: "2026-01-01T00:00:00Z",
    transaction_hash: "a".repeat(64),
    transaction: {
      hash: "a".repeat(64),
      ledger: 4426886,
      memo: "invoice-42",
      memo_type: "text",
      successful: true,
    },
    ...overrides,
  };
}

function collect(harness: Harness, address: string): NormalizedEvent[] {
  const seen: NormalizedEvent[] = [];
  harness.engine.subscribe(address).on("*", (event) => {
    seen.push(event as NormalizedEvent);
  });
  return seen;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classic event transaction identity", () => {
  it("asks Horizon to join the transaction onto every operation", () => {
    const harness = buildEngine();
    expect(harness.joinCalls).toEqual(["transactions"]);
  });

  it("surfaces txHash, ledger and memo on a payment", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GDEST");

    harness.simulateRecord(paymentRecord());

    expect(seen).toHaveLength(1);
    const event = seen[0]!;
    expect(event.type).toBe("payment.received");
    expect(event.txHash).toBe("a".repeat(64));
    expect(event.ledger).toBe(4426886);
    expect(event.memo).toBe("invoice-42");
  });

  it("omits memo when the transaction carried none", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GDEST");

    harness.simulateRecord(
      paymentRecord({
        transaction: { hash: "a".repeat(64), ledger: 7, memo: null, memo_type: "none" },
      }),
    );

    const event = seen[0]!;
    expect("memo" in event).toBe(false);
    expect(event.ledger).toBe(7);
    expect(event.txHash).toBe("a".repeat(64));
  });

  it("still surfaces txHash when the transaction was not joined", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GDEST");

    const { transaction: _omitted, ...withoutJoin } = paymentRecord();
    harness.simulateRecord(withoutJoin);

    const event = seen[0]!;
    expect(event.txHash).toBe("a".repeat(64));
    expect("ledger" in event).toBe(false);
    expect("memo" in event).toBe(false);
  });

  it("carries no identity keys at all when Horizon supplies none", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GDEST");

    const { transaction: _tx, transaction_hash: _hash, ...bare } = paymentRecord();
    harness.simulateRecord(bare);

    const event = seen[0]!;
    expect("txHash" in event).toBe(false);
    expect("ledger" in event).toBe(false);
    expect("memo" in event).toBe(false);
  });

  it("extends the same three fields to non-payment classic events", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GMERGED");

    harness.simulateRecord({
      type: "account_merge",
      account: "GMERGED",
      into: "GDEST",
      created_at: "2026-01-01T00:00:00Z",
      transaction_hash: "b".repeat(64),
      transaction: {
        hash: "b".repeat(64),
        ledger: 99,
        memo: "closing",
        memo_type: "text",
      },
    });

    const event = seen[0]!;
    expect(event.type).toBe("account.merged");
    expect(event.txHash).toBe("b".repeat(64));
    expect(event.ledger).toBe(99);
    expect(event.memo).toBe("closing");
  });

  it("makes deriveDedupeKey usable on the classic path", () => {
    const harness = buildEngine();
    const seen = collect(harness, "GDEST");

    // The same payment delivered twice - a redelivery after a reconnect, or
    // the same movement seen over both transports during a routing switch.
    harness.simulateRecord(paymentRecord());
    harness.simulateRecord(paymentRecord());

    const window = new DedupeWindow(16);
    const delivered = seen.filter((event) => {
      const txHash = event.txHash;
      if (!txHash) return true;
      return !window.seenBefore(deriveDedupeKey({ txHash, index: 0 }));
    });

    expect(seen).toHaveLength(2);
    expect(delivered).toHaveLength(1);
  });
});
