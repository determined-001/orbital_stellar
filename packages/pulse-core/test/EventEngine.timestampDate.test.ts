/**
 * timestampDate getter – focused tests
 *
 * Verifies that every NormalizedEvent exposes a non-enumerable lazy cached
 * `timestampDate` getter and that JSON serialization is unaffected.
 *
 * Uses the same `normalize()` private-method cast pattern as pulse-core.test.ts —
 * no mock, no engine.start(), no stream infrastructure needed.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";

// ---------------------------------------------------------------------------
// Helper: access the private normalize() method via type cast (project pattern)
// ---------------------------------------------------------------------------

type WithNormalize = { normalize(record: unknown): unknown };

const PAYMENT_RECORD = {
  type: "payment",
  to: "GDST",
  from: "GSRC",
  amount: "100",
  asset_type: "native",
  created_at: "2026-05-31T12:00:00.000Z",
};

function getNormalize() {
  const engine = new EventEngine({ network: "testnet" });
  return (engine as unknown as WithNormalize).normalize.bind(engine);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NormalizedEvent.timestampDate", () => {
  it("first access returns a Date instance", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as { timestampDate: Date };
    expect(evt.timestampDate).toBeInstanceOf(Date);
  });

  it("timestampDate is parsed from event.timestamp", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as { timestamp: string; timestampDate: Date };
    expect(evt.timestampDate.toISOString()).toBe(evt.timestamp);
  });

  it("subsequent accesses return the same cached instance (strict reference equality)", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as { timestampDate: Date };
    const first = evt.timestampDate;
    const second = evt.timestampDate;
    expect(first).toBe(second);
  });

  it("timestamp is parsed only once (Date constructor not called again after first access)", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as { timestampDate: Date };

    // Prime the cache.
    void evt.timestampDate;

    // Subsequent accesses must not invoke Date() again.
    const spy = vi.spyOn(globalThis, "Date");
    void evt.timestampDate;
    void evt.timestampDate;
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("property is non-enumerable", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as object;
    const descriptor = Object.getOwnPropertyDescriptor(evt, "timestampDate");
    expect(descriptor?.enumerable).toBe(false);
  });

  it("JSON.stringify output does not include timestampDate", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as { timestampDate: Date };
    // Access once to force caching, then confirm it is absent from JSON.
    void evt.timestampDate;
    expect(JSON.stringify(evt)).not.toContain("timestampDate");
  });

  it("JSON serialization keys match baseline (no extra keys added)", () => {
    const normalize = getNormalize();
    const evt = normalize(PAYMENT_RECORD) as object;
    // Trigger getter.
    void (evt as { timestampDate?: Date }).timestampDate;
    const keys = Object.keys(JSON.parse(JSON.stringify(evt)));
    expect(keys).not.toContain("timestampDate");
  });
});
