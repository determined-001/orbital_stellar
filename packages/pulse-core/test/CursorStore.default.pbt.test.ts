import { describe, it } from "vitest";
import * as fc from "fast-check";
import { CursorStore } from "../src/CursorStore.js";

// ---------------------------------------------------------------------------
// Minimal in-memory stub for property tests
// ---------------------------------------------------------------------------

class InMemoryCursorStore extends CursorStore {
  private readonly store = new Map<string, string>();
  readonly setCalls: Array<{ key: string; value: string }> = [];

  async get(streamKey: string): Promise<string | null> {
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.setCalls.push({ key: streamKey, value: cursor });
    this.store.set(streamKey, cursor);
  }
}

// Exclude prototype-poisoning keys that behave differently with plain objects.
// Real stream keys (Stellar addresses, paging tokens) are never these values.
const PROTO_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
];
const safeKey = fc.string({ minLength: 1 }).filter((k) => !PROTO_KEYS.includes(k));

// ---------------------------------------------------------------------------
// Property 1: Default getMany round-trip
// Feature: cursor-store-batch-operations, Property 1: Default getMany round-trip
// Validates: Requirements 2.3, 5.1
// ---------------------------------------------------------------------------

describe("CursorStore default PBT", () => {
  it("Property 1: Default getMany round-trip — for any written entries, getMany returns the written values", async () => {
    await fc.assert(
      fc.asyncProperty(fc.dictionary(safeKey, fc.string({ minLength: 1 })), async (entries) => {
        const store = new InMemoryCursorStore();

        for (const [key, value] of Object.entries(entries)) {
          await store.set(key, value);
        }

        const keys = Object.keys(entries);
        if (keys.length === 0) return true; // trivially true

        const result = await store.getMany(keys);

        for (const [key, value] of Object.entries(entries)) {
          if (result[key] !== value) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 2: Default getMany null for missing keys
  // Feature: cursor-store-batch-operations, Property 2: Default getMany null for missing keys
  // Validates: Requirements 1.6, 2.1
  // ---------------------------------------------------------------------------

  it("Property 2: Default getMany null for missing keys — keys never written map to null", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(safeKey, { minLength: 1, maxLength: 20 }), async (keys) => {
        const store = new InMemoryCursorStore();
        // Nothing written — all keys are missing

        const result = await store.getMany(keys);

        for (const key of keys) {
          if (result[key] !== null) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 3: Default setMany delegates once per entry
  // Feature: cursor-store-batch-operations, Property 3: Default setMany delegates once per entry
  // Validates: Requirements 2.2, 5.2
  // ---------------------------------------------------------------------------

  it("Property 3: Default setMany delegates once per entry — set is called exactly once per key", async () => {
    await fc.assert(
      fc.asyncProperty(fc.dictionary(safeKey, fc.string({ minLength: 1 })), async (entries) => {
        const store = new InMemoryCursorStore();

        await store.setMany(entries);

        const expectedCount = Object.keys(entries).length;
        return store.setCalls.length === expectedCount;
      }),
      { numRuns: 100 },
    );
  });
});
