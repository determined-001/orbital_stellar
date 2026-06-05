# Implementation Plan: cursor-store-batch-operations

## Overview

Promote `CursorStore` from an interface to an abstract class with default `getMany`/`setMany` implementations, update `PostgresCursorStore` to extend it with efficient single-query overrides, add a new `RedisCursorStore` adapter, and export both from the public API. Tests cover unit, property-based, and integration scenarios.

## Tasks

- [ ] 1. Promote `CursorStore` to an abstract class with default batch methods
  - [ ] 1.1 Rewrite `packages/pulse-core/src/CursorStore.ts` as an abstract class
    - Replace the `interface CursorStore` declaration with `export abstract class CursorStore`
    - Keep `get` and `set` as `abstract` methods with their existing JSDoc
    - Add concrete `async getMany(keys: string[]): Promise<Record<string, string | null>>` that short-circuits on empty input and delegates to `this.get(key)` sequentially
    - Add concrete `async setMany(entries: Record<string, string>): Promise<void>` that short-circuits on empty input and delegates to `this.set(key, value)` sequentially
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.5, 5.3_

- [ ] 2. Update `PostgresCursorStore` to extend the abstract class and add batch overrides
  - [ ] 2.1 Change `implements CursorStore` to `extends CursorStore` in `PostgresCursorStore.ts`
    - Update the class declaration line only; no other logic changes in this step
    - _Requirements: 3.1, 3.2_

  - [ ] 2.2 Add `getMany` override to `PostgresCursorStore`
    - Short-circuit and return `{}` when `keys` is empty (no SQL issued)
    - Execute a single `SELECT stream_key, cursor FROM cursor_store WHERE stream_key = ANY($1::text[])` query
    - Build the result record by iterating rows; set any key absent from rows to `null`
    - _Requirements: 3.1, 3.3, 3.4_

  - [ ] 2.3 Add `setMany` override to `PostgresCursorStore`
    - Short-circuit and return when `entries` is empty (no SQL issued)
    - Execute a single `INSERT INTO cursor_store (stream_key, cursor, updated_at) SELECT unnest($1::text[]), unnest($2::text[]), NOW() ON CONFLICT (stream_key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()` upsert
    - _Requirements: 3.2, 3.5, 3.6_

- [ ] 3. Create `RedisCursorStore` adapter
  - [ ] 3.1 Create `packages/pulse-core/src/RedisCursorStore.ts` with `RedisLike` interface and `RedisCursorStore` class
    - Define and export `RedisLike` interface with `get`, `set`, `mget`, `mset` signatures exactly as specified in the design
    - Implement `RedisCursorStore extends CursorStore` with a constructor accepting `RedisLike`
    - Implement `get` and `set` by delegating directly to `this.redis.get` / `this.redis.set`
    - Implement `getMany`: short-circuit on empty input; call `this.redis.mget(...keys)` once; map positional results back to keys using `values[i] ?? null`
    - Implement `setMany`: short-circuit on empty input; flatten entries to `[k1, v1, k2, v2, …]`; call `this.redis.mset(...args)` once
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8_

- [ ] 4. Update public API exports
  - [ ] 4.1 Add `RedisCursorStore` and `RedisLike` named exports to `packages/pulse-core/src/index.ts`
    - Append `export { RedisCursorStore, RedisLike } from "./RedisCursorStore.js";` without removing any existing exports
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 5. Checkpoint — verify TypeScript compilation
  - Run `tsc --noEmit` (the `typecheck` script) to confirm all three classes compile cleanly and `getMany`/`setMany` are resolvable on the exported `CursorStore` type.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Write unit and property-based tests for the default `CursorStore` implementation
  - [ ] 6.1 Create `packages/pulse-core/test/CursorStore.default.test.ts` with example-based unit tests
    - Implement a minimal concrete subclass (stub) that records `get`/`set` calls for use across tests
    - Test `getMany` with an empty array returns `{}`
    - Test `setMany` with an empty object resolves without calling `set`
    - Test `getMany` with N keys calls `get` N times and maps values correctly (including `null`)
    - Test `setMany` with N entries calls `set` N times with correct key-value pairs
    - Test that an error thrown by `get` propagates out of `getMany`
    - Test that an error thrown by `set` propagates out of `setMany`
    - _Requirements: 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 5.1, 5.2_

  - [ ]* 6.2 Write property test for Property 1: Default getMany round-trip
    - Install `fast-check` as a dev dependency if not already present
    - Use `fc.dictionary(fc.string(), fc.string())` to generate arbitrary key-value maps
    - Write each entry via `set`, then call `getMany` with all keys; assert every key maps to its written value
    - Tag: `// Feature: cursor-store-batch-operations, Property 1: Default getMany round-trip`
    - **Property 1: Default getMany round-trip**
    - **Validates: Requirements 2.3, 5.1**

  - [ ]* 6.3 Write property test for Property 2: Default getMany null for missing keys
    - Use `fc.array(fc.string())` to generate keys that are never written
    - Call `getMany` with those keys; assert every key maps to `null`
    - Tag: `// Feature: cursor-store-batch-operations, Property 2: Default getMany null for missing keys`
    - **Property 2: Default getMany null for missing keys**
    - **Validates: Requirements 1.6, 2.1**

  - [ ]* 6.4 Write property test for Property 3: Default setMany delegates once per entry
    - Use `fc.dictionary(fc.string(), fc.string())` to generate arbitrary entry maps
    - Call `setMany`; assert `set` was called exactly `Object.keys(entries).length` times, once per key
    - Tag: `// Feature: cursor-store-batch-operations, Property 3: Default setMany delegates once per entry`
    - **Property 3: Default setMany delegates once per entry**
    - **Validates: Requirements 2.2, 5.2**

- [ ] 7. Write unit and property-based tests for `PostgresCursorStore` batch methods
  - [ ] 7.1 Extend `packages/pulse-core/test/PostgresCursorStore.test.ts` with unit tests for `getMany` and `setMany`
    - Add a `describe` block for unit tests using a mock `PgLike` (plain object recording calls)
    - Test `getMany` with empty array returns `{}` and issues no query
    - Test `getMany` with N keys issues exactly one query and maps rows to values; absent keys map to `null`
    - Test `setMany` with empty object returns without issuing any query
    - Test `setMany` with N entries issues exactly one query
    - Test that a `pg.query` error propagates from both `getMany` and `setMany`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [ ]* 7.2 Write property test for Property 4: PostgresCursorStore getMany issues exactly one query
    - Create `packages/pulse-core/test/PostgresCursorStore.pbt.test.ts`
    - Use `fc.array(fc.string(), { minLength: 1 })` for keys; mock `PgLike` counts `query` calls
    - Assert `query` call count equals 1 for any non-empty key array
    - Tag: `// Feature: cursor-store-batch-operations, Property 4: PostgresCursorStore getMany issues exactly one query`
    - **Property 4: PostgresCursorStore getMany issues exactly one query**
    - **Validates: Requirements 3.1**

  - [ ]* 7.3 Write property test for Property 5: PostgresCursorStore setMany issues exactly one query
    - Use `fc.dictionary(fc.string(), fc.string(), { minKeys: 1 })` for entries; mock `PgLike` counts `query` calls
    - Assert `query` call count equals 1 for any non-empty entries map
    - Tag: `// Feature: cursor-store-batch-operations, Property 5: PostgresCursorStore setMany issues exactly one query`
    - **Property 5: PostgresCursorStore setMany issues exactly one query**
    - **Validates: Requirements 3.2**

  - [ ]* 7.4 Write property test for Property 6: PostgresCursorStore batch round-trip
    - Use `fc.dictionary(fc.string(), fc.string(), { minKeys: 1 })` for entries; use an in-memory mock `PgLike` that stores rows
    - Call `setMany` then `getMany` with the same keys; assert each key maps to its written value
    - Tag: `// Feature: cursor-store-batch-operations, Property 6: PostgresCursorStore batch round-trip`
    - **Property 6: PostgresCursorStore batch round-trip**
    - **Validates: Requirements 3.6**

- [ ] 8. Write unit and property-based tests for `RedisCursorStore`
  - [ ] 8.1 Create `packages/pulse-core/test/RedisCursorStore.test.ts` with example-based unit tests
    - Use a mock `RedisLike` (plain object recording calls and storing state)
    - Test `get` and `set` delegate to `redis.get` / `redis.set`
    - Test `getMany` with empty array returns `{}` and does not call `mget`
    - Test `getMany` with N keys calls `mget` exactly once with all keys; maps positional results to keys; maps `null`/`undefined` to `null`
    - Test `setMany` with empty object returns without calling `mset`
    - Test `setMany` with N entries calls `mset` exactly once with the flat interleaved args array
    - Test that errors from `redis.mget` and `redis.mset` propagate
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.9_

  - [ ]* 8.2 Write property test for Property 7: RedisCursorStore getMany issues exactly one MGET
    - Create `packages/pulse-core/test/RedisCursorStore.pbt.test.ts`
    - Use `fc.array(fc.string(), { minLength: 1 })` for keys; mock `RedisLike` counts `mget` calls
    - Assert `mget` is called exactly once for any non-empty key array
    - Tag: `// Feature: cursor-store-batch-operations, Property 7: RedisCursorStore getMany issues exactly one MGET`
    - **Property 7: RedisCursorStore getMany issues exactly one MGET**
    - **Validates: Requirements 4.2**

  - [ ]* 8.3 Write property test for Property 8: RedisCursorStore setMany issues exactly one MSET
    - Use `fc.dictionary(fc.string(), fc.string(), { minKeys: 1 })` for entries; mock `RedisLike` counts `mset` calls
    - Assert `mset` is called exactly once for any non-empty entries map
    - Tag: `// Feature: cursor-store-batch-operations, Property 8: RedisCursorStore setMany issues exactly one MSET`
    - **Property 8: RedisCursorStore setMany issues exactly one MSET**
    - **Validates: Requirements 4.3**

  - [ ]* 8.4 Write property test for Property 9: RedisCursorStore batch round-trip
    - Use `fc.dictionary(fc.string(), fc.string(), { minKeys: 1 })` for entries; use an in-memory mock `RedisLike`
    - Call `setMany` then `getMany` with the same keys; assert each key maps to its written value with no encoding change
    - Tag: `// Feature: cursor-store-batch-operations, Property 9: RedisCursorStore batch round-trip`
    - **Property 9: RedisCursorStore batch round-trip**
    - **Validates: Requirements 4.7**

  - [ ]* 8.5 Write property test for Property 10: Null handling is consistent across all adapters
    - In `RedisCursorStore.pbt.test.ts`, use `fc.array(fc.string(), { minLength: 1 })` for keys never written to the mock store
    - Assert that `getMany` returns `null` for every such key across the default, Postgres (mock), and Redis (mock) adapters
    - Tag: `// Feature: cursor-store-batch-operations, Property 10: Null handling is consistent across all adapters`
    - **Property 10: Null handling is consistent across all adapters**
    - **Validates: Requirements 1.6, 3.3, 4.4**

- [ ] 9. Checkpoint — run full test suite
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Add Postgres batch integration tests
  - [ ] 10.1 Create `packages/pulse-core/test/integration/PostgresCursorStore.batch.integration.test.ts`
    - Guard the entire suite behind `process.env.INTEGRATION_TESTS === "true"` (same pattern as existing integration tests)
    - Test `getMany` against a real Postgres instance: write rows via `set`, read via `getMany`, assert round-trip correctness
    - Test `setMany` against a real Postgres instance: write via `setMany`, read via `getMany`, assert no extra rows are created (upsert semantics)
    - Test `getMany` with keys that have no stored cursor returns `null` for those keys
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

- [ ] 11. Final checkpoint — full suite and typecheck
  - Run `vitest run` and `tsc --noEmit` to confirm all tests pass and the package compiles cleanly.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `fast-check` must be added as a dev dependency in `packages/pulse-core/package.json` before running property tests
- The existing `PostgresCursorStore.test.ts` is an integration-only file; the new unit tests for batch methods should be added in a separate `describe` block guarded by a mock `PgLike`, not requiring `INTEGRATION_TESTS=true`
- All property tests run a minimum of 100 iterations (fast-check default)
- The `typecheck` script (`tsc --noEmit`) serves as the smoke test for Requirement 6.3
- No schema migration is required — the batch upsert reuses the existing `ON CONFLICT (stream_key) DO UPDATE` strategy

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1"] },
    { "id": 3, "tasks": ["6.1", "7.1", "8.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "7.2", "7.3", "8.2", "8.3", "8.4", "10.1"] },
    { "id": 5, "tasks": ["7.4", "8.5"] }
  ]
}
```
