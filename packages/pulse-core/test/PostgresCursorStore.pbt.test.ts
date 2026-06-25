import { describe, it } from "vitest";
import * as fc from "fast-check";
import { PostgresCursorStore } from "../src/PostgresCursorStore.js";
import type { PgLike } from "../src/PostgresCursorStore.js";

// ---------------------------------------------------------------------------
// Mock PgLike helpers for property tests
// ---------------------------------------------------------------------------

function makeCountingPg(): { pg: PgLike; queryCount: number[] } {
  const queryCount = [0];
  const pg: PgLike = {
    query: async () => {
      queryCount[0]++;
      return { rows: [] };
    },
  };
  return { pg, queryCount };
}

function makeInMemoryPg(): { pg: PgLike; store: Map<string, string> } {
  const store = new Map<string, string>();
  const pg: PgLike = {
    query: async (text: string, params?: unknown[]) => {
      // INSERT must be checked before SELECT because the setMany SQL is
      // "INSERT INTO … SELECT unnest(…)" which contains both keywords.
      if (
        text.trimStart().startsWith("INSERT") &&
        params &&
        Array.isArray(params[0]) &&
        Array.isArray(params[1])
      ) {
        const keys = params[0] as string[];
        const cursors = params[1] as string[];
        for (let i = 0; i < keys.length; i++) {
          store.set(keys[i]!, cursors[i]!);
        }
        return { rows: [] };
      }
      // SELECT … WHERE stream_key = ANY($1::text[])
      if (text.trimStart().startsWith("SELECT") && params && Array.isArray(params[0])) {
        const keys = params[0] as string[];
        const rows = keys
          .filter((k) => store.has(k))
          .map((k) => ({ stream_key: k, cursor: store.get(k)! }));
        return { rows };
      }
      return { rows: [] };
    },
  };
  return { pg, store };
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
// Property 4: PostgresCursorStore getMany issues exactly one query
// Feature: cursor-store-batch-operations, Property 4: PostgresCursorStore getMany issues exactly one query
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

describe("PostgresCursorStore PBT", () => {
  it("Property 4: getMany issues exactly one SQL query for any non-empty key array", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(safeKey, { minLength: 1, maxLength: 50 }), async (keys) => {
        const { pg, queryCount } = makeCountingPg();
        const store = new PostgresCursorStore(pg);

        await store.getMany(keys);

        return queryCount[0] === 1;
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 5: PostgresCursorStore setMany issues exactly one query
  // Feature: cursor-store-batch-operations, Property 5: PostgresCursorStore setMany issues exactly one query
  // Validates: Requirements 3.2
  // ---------------------------------------------------------------------------

  it("Property 5: setMany issues exactly one SQL query for any non-empty entries map", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const { pg, queryCount } = makeCountingPg();
          const store = new PostgresCursorStore(pg);

          await store.setMany(entries);

          return queryCount[0] === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Property 6: PostgresCursorStore batch round-trip
  // Feature: cursor-store-batch-operations, Property 6: PostgresCursorStore batch round-trip
  // Validates: Requirements 3.6
  // ---------------------------------------------------------------------------

  it("Property 6: setMany then getMany returns the written values without transformation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(safeKey, fc.string({ minLength: 1 }), { minKeys: 1 }),
        async (entries) => {
          const { pg } = makeInMemoryPg();
          const store = new PostgresCursorStore(pg);

          await store.setMany(entries);
          const result = await store.getMany(Object.keys(entries));

          for (const [key, value] of Object.entries(entries)) {
            if (result[key] !== value) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
