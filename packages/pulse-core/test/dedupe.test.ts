/**
 * Dedupe primitive tests (issue 6.13): key derivation + bounded window.
 *
 * This does not exercise a live EventEngine delivery path - per the issue's
 * blocker (6.12) not yet wiring live routing/dispatch, these tests only
 * cover the standalone primitive: given refs from either transport, does
 * the derived key collide correctly, and does the window suppress/bound as
 * specified.
 */
import { describe, it, expect } from "vitest";
import { deriveDedupeKey, DedupeWindow, InvalidDedupeWindowCapacityError } from "../src/dedupe.js";
import type { DedupeEventRef } from "../src/dedupe.js";

describe("deriveDedupeKey", () => {
  it("produces the same key for the same txHash + index", () => {
    const a: DedupeEventRef = { txHash: "abc123", index: 0 };
    const b: DedupeEventRef = { txHash: "abc123", index: 0 };
    expect(deriveDedupeKey(a)).toBe(deriveDedupeKey(b));
  });

  it("produces different keys for different indexes in the same transaction", () => {
    const a = deriveDedupeKey({ txHash: "abc123", index: 0 });
    const b = deriveDedupeKey({ txHash: "abc123", index: 1 });
    expect(a).not.toBe(b);
  });

  it("produces different keys for different transactions", () => {
    const a = deriveDedupeKey({ txHash: "abc123", index: 0 });
    const b = deriveDedupeKey({ txHash: "def456", index: 0 });
    expect(a).not.toBe(b);
  });

  it("derives an identical key whether the ref came from a Horizon operation or a unified event", () => {
    // Simulates the scenario in the issue: the same on-chain movement,
    // observed once via a Horizon operation record (txHash + operation
    // index) and once via a CAP-67 unified-stream event (txHash + event
    // ordinal) - both transports must agree on one key for it.
    const fromHorizonOperation: DedupeEventRef = {
      txHash: "8893b6db51a5c6b3a1ee0a019cb0f11af45e3c41c34a10349ce4d2df7419d620",
      index: 0,
    };
    const fromUnifiedEvent: DedupeEventRef = {
      txHash: "8893b6db51a5c6b3a1ee0a019cb0f11af45e3c41c34a10349ce4d2df7419d620",
      index: 0,
    };

    expect(deriveDedupeKey(fromHorizonOperation)).toBe(deriveDedupeKey(fromUnifiedEvent));
  });
});

describe("DedupeWindow", () => {
  it("rejects a non-positive or non-integer capacity", () => {
    expect(() => new DedupeWindow(0)).toThrow(InvalidDedupeWindowCapacityError);
    expect(() => new DedupeWindow(-1)).toThrow(InvalidDedupeWindowCapacityError);
    expect(() => new DedupeWindow(1.5)).toThrow(InvalidDedupeWindowCapacityError);
  });

  it("returns false the first time a key is seen, true on repeats", () => {
    const window = new DedupeWindow(10);
    const key = deriveDedupeKey({ txHash: "abc", index: 0 });

    expect(window.seenBefore(key)).toBe(false);
    expect(window.seenBefore(key)).toBe(true);
    expect(window.seenBefore(key)).toBe(true);
  });

  it("delivers the same fixture event exactly once across both transports", () => {
    const window = new DedupeWindow(10);
    const horizonRef: DedupeEventRef = { txHash: "tx-1", index: 0 };
    const unifiedRef: DedupeEventRef = { txHash: "tx-1", index: 0 };

    const delivered: string[] = [];
    for (const ref of [horizonRef, unifiedRef]) {
      const key = deriveDedupeKey(ref);
      if (!window.seenBefore(key)) {
        delivered.push(key);
      }
    }

    expect(delivered).toHaveLength(1);
  });

  it("tracks independent keys separately", () => {
    const window = new DedupeWindow(10);
    const keyA = deriveDedupeKey({ txHash: "tx-a", index: 0 });
    const keyB = deriveDedupeKey({ txHash: "tx-b", index: 0 });

    expect(window.seenBefore(keyA)).toBe(false);
    expect(window.seenBefore(keyB)).toBe(false);
    expect(window.seenBefore(keyA)).toBe(true);
    expect(window.seenBefore(keyB)).toBe(true);
  });

  it("never grows the window past its capacity", () => {
    const window = new DedupeWindow(5);
    for (let i = 0; i < 100; i++) {
      window.seenBefore(deriveDedupeKey({ txHash: "tx", index: i }));
      expect(window.size).toBeLessThanOrEqual(5);
    }
    expect(window.size).toBe(5);
  });

  it("evicts the oldest key once at capacity, so it is no longer suppressed", () => {
    const window = new DedupeWindow(2);
    const keyA = deriveDedupeKey({ txHash: "tx-a", index: 0 });
    const keyB = deriveDedupeKey({ txHash: "tx-b", index: 0 });
    const keyC = deriveDedupeKey({ txHash: "tx-c", index: 0 });

    expect(window.seenBefore(keyA)).toBe(false);
    expect(window.seenBefore(keyB)).toBe(false);
    // Window is now full at capacity 2: [keyA, keyB].
    expect(window.seenBefore(keyC)).toBe(false);
    // Inserting keyC evicted keyA (the oldest) - it's no longer tracked, so
    // it reads as "not seen before" again rather than leaking forever.
    expect(window.seenBefore(keyA)).toBe(false);
    // keyB and keyC are still within the window.
    expect(window.size).toBe(2);
  });
});
