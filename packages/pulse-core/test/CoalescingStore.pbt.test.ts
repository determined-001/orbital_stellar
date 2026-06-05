import { describe, it } from "vitest";
import * as fc from "fast-check";
import { coalesceCursorStore } from "../src/coalesceCursorStore.js";
import { CursorStore } from "../src/CursorStore.js";

// ---------------------------------------------------------------------------
// FakeInnerStore for property tests
// ---------------------------------------------------------------------------

class FakeInnerStore extends CursorStore {
  readonly store = new Map<string, string>();
  readonly getCalls: string[] = [];
  readonly getManyCalls: string[][] = [];
  readonly setManyCalls: Array<Record<string, string>> = [];
  /** Optional artificial delay for setMany (ms) — used in concurrency tests */
  setManyDelayMs = 0;

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  override async getMany(keys: string[]): Promise<Record<string, string | null>> {
    this.getManyCalls.push([...keys]);
    const result: Record<string, string | null> = {};
    for (const k of keys) result[k] = this.store.get(k) ?? null;
    return result;
  }

  override async setMany(entries: Record<string, string>): Promise<void> {
    if (this.setManyDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.setManyDelayMs));
    }
    this.setManyCalls.push({ ...entries });
    for (const [k, v] of Object.entries(entries)) this.store.set(k, v);
  }
}

// Exclude prototype-poisoning keys
const PROTO_KEYS = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"];
const safeKey = fc.string({ minLength: 1 }).filter((k) => !PROTO_KEYS.includes(k));

// ---------------------------------------------------------------------------
// Property 1: Invalid intervalMs throws RangeError
// Feature: coalesce-cursor-store, Property 1: Invalid intervalMs throws RangeError
// Validates: Requirements 1.2, 1.3
// ---------------------------------------------------------------------------

describe("CoalescingStore PBT", () => {
  it("Property 1: coalesceCursorStore throws RangeError for any invalid intervalMs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(0),
          fc.integer({ max: -1 }),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity)
        ),
        (intervalMs) => {
          let threw = false;
          try {
            const s = coalesceCursorStore(new FakeInnerStore(), { intervalMs });
            s.dispose(); // clean up if it somehow didn't throw
          } catch (e) {
            threw = e instanceof RangeError;
          }
          return threw;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 2: set buffers without touching InnerStore
  // Feature: coalesce-cursor-store, Property 2: set buffers without touching InnerStore
  // Validates: Requirements 2.1
  // ---------------------------------------------------------------------------

  it("Property 2: set buffers without touching InnerStore", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeKey,
        fc.string({ minLength: 1 }),
        async (streamKey, cursor) => {
          const inner = new FakeInnerStore();
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          await store.set(streamKey, cursor);

          store.dispose();
          return inner.setManyCalls.length === 0 && inner.getCalls.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 3: Last-write-wins coalescing
  // Feature: coalesce-cursor-store, Property 3: Last-write-wins coalescing
  // Validates: Requirements 2.2, 3.4
  // ---------------------------------------------------------------------------

  it("Property 3: Last-write-wins coalescing — get and flush return the last written value", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeKey,
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 20 }),
        async (streamKey, cursors) => {
          const inner = new FakeInnerStore();
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          for (const cursor of cursors) {
            await store.set(streamKey, cursor);
          }

          const lastCursor = cursors[cursors.length - 1]!;

          const bufferedValue = await store.get(streamKey);
          if (bufferedValue !== lastCursor) { store.dispose(); return false; }

          await store.flush();
          store.dispose();

          const flushedValue = inner.setManyCalls[0]?.[streamKey];
          return flushedValue === lastCursor;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 4: setMany buffers all entries without touching InnerStore
  // Feature: coalesce-cursor-store, Property 4: setMany buffers all entries without touching InnerStore
  // Validates: Requirements 2.3
  // ---------------------------------------------------------------------------

  it("Property 4: setMany buffers all entries without touching InnerStore", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const inner = new FakeInnerStore();
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          await store.setMany(entries);

          store.dispose();
          return inner.setManyCalls.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 5: flush drains the buffer to InnerStore exactly once
  // Feature: coalesce-cursor-store, Property 5: flush drains the buffer to InnerStore exactly once
  // Validates: Requirements 3.2, 4.1
  // ---------------------------------------------------------------------------

  it("Property 5: flush drains buffer to InnerStore exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const inner = new FakeInnerStore();
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          await store.setMany(entries);
          await store.flush();

          // Exactly one setMany call
          if (inner.setManyCalls.length !== 1) { store.dispose(); return false; }

          // All entries present in the call
          const call = inner.setManyCalls[0]!;
          for (const [k, v] of Object.entries(entries)) {
            if (call[k] !== v) { store.dispose(); return false; }
          }

          // Buffer is empty — second flush produces no additional call
          await store.flush();
          store.dispose();
          return inner.setManyCalls.length === 1;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 6: get serves buffered values without delegating to InnerStore
  // Feature: coalesce-cursor-store, Property 6: get serves buffered values without delegating to InnerStore
  // Validates: Requirements 5.1
  // ---------------------------------------------------------------------------

  it("Property 6: get serves buffered values without delegating to InnerStore", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeKey,
        fc.string({ minLength: 1 }),
        async (streamKey, cursor) => {
          const inner = new FakeInnerStore();
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          await store.set(streamKey, cursor);
          const result = await store.get(streamKey);

          store.dispose();
          return result === cursor && inner.getCalls.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 7: get delegates to InnerStore for keys absent from buffer
  // Feature: coalesce-cursor-store, Property 7: get delegates to InnerStore for keys absent from buffer
  // Validates: Requirements 5.2
  // ---------------------------------------------------------------------------

  it("Property 7: get delegates to InnerStore for keys absent from buffer", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeKey,
        fc.string({ minLength: 1 }),
        async (streamKey, cursor) => {
          const inner = new FakeInnerStore();
          inner.store.set(streamKey, cursor);
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          const result = await store.get(streamKey);

          store.dispose();
          return result === cursor && inner.getCalls.includes(streamKey);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 8: getMany splits reads between buffer and InnerStore
  // Feature: coalesce-cursor-store, Property 8: getMany splits reads between buffer and InnerStore
  // Validates: Requirements 5.3
  // ---------------------------------------------------------------------------

  it("Property 8: getMany splits reads between buffer and InnerStore correctly", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (bufferedEntries, innerEntries) => {
          // Ensure the two key sets are disjoint
          const bufferedKeys = Object.keys(bufferedEntries);
          const innerKeys = Object.keys(innerEntries).filter((k) => !bufferedKeys.includes(k));
          if (innerKeys.length === 0) return true; // skip if no disjoint inner keys

          const inner = new FakeInnerStore();
          for (const k of innerKeys) inner.store.set(k, innerEntries[k]!);

          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });
          await store.setMany(bufferedEntries);

          const allKeys = [...bufferedKeys, ...innerKeys];
          const result = await store.getMany(allKeys);

          store.dispose();

          // Buffered keys return buffered values
          for (const k of bufferedKeys) {
            if (result[k] !== bufferedEntries[k]) return false;
          }
          // Inner keys return inner-store values
          for (const k of innerKeys) {
            if (result[k] !== innerEntries[k]) return false;
          }
          // Buffered keys were NOT delegated to InnerStore.getMany
          const delegatedKeys = inner.getManyCalls.flat();
          for (const k of bufferedKeys) {
            if (delegatedKeys.includes(k)) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 9: Concurrent flush serialization — each entry written exactly once
  // Feature: coalesce-cursor-store, Property 9: Concurrent flush serialization — each entry written exactly once
  // Validates: Requirements 4.3
  // ---------------------------------------------------------------------------

  it("Property 9: Concurrent flush serialization — each entry written exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1, maxKeys: 10 }),
        async (entries) => {
          const inner = new FakeInnerStore();
          inner.setManyDelayMs = 10; // artificial async delay to expose races
          const store = coalesceCursorStore(inner, { intervalMs: 10_000 });

          await store.setMany(entries);

          // Fire two concurrent flushes
          await Promise.all([store.flush(), store.flush()]);
          store.dispose();

          // Collect all keys written across all setMany calls
          const writtenKeys: Record<string, string[]> = {};
          for (const call of inner.setManyCalls) {
            for (const [k, v] of Object.entries(call)) {
              if (!writtenKeys[k]) writtenKeys[k] = [];
              writtenKeys[k]!.push(v);
            }
          }

          // Each key must appear exactly once across all calls
          for (const key of Object.keys(entries)) {
            const writes = writtenKeys[key] ?? [];
            if (writes.length !== 1) return false;
            if (writes[0] !== entries[key]) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
