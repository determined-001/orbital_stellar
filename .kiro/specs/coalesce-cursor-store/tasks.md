# Implementation Plan: coalesce-cursor-store

## Overview

Implement `coalesceCursorStore`, a write-coalescing decorator for any `CursorStore` in `@orbital/pulse-core`. The implementation lives in a single new source file, is exported from the package index, and is covered by both example-based unit tests (with Vitest fake timers) and property-based tests (fast-check) for all 9 correctness properties defined in the design.

## Tasks

- [ ] 1. Implement `CoalescingStore` class and `coalesceCursorStore` factory
  - [ ] 1.1 Create `packages/pulse-core/src/coalesceCursorStore.ts` with `CoalescingStoreOptions` interface, `CoalescingStore` class, and `coalesceCursorStore` factory
    - Define `CoalescingStoreOptions` with `intervalMs: number`
    - Implement `CoalescingStore extends CursorStore` with private fields `#inner`, `#buffer` (`Map<string, string>`), `#timer`, and `#flushInProgress` (`Promise<void>`)
    - Implement `set(streamKey, cursor)` — writes to `#buffer` only, returns immediately
    - Implement `setMany(entries)` — merges all entries into `#buffer` only, returns immediately
    - Implement `get(streamKey)` — returns buffered value if present, otherwise delegates to `#inner.get`
    - Implement `getMany(keys)` — splits keys between buffer and `#inner.getMany`, merges results
    - Implement private `#doFlush()` — snapshot-then-clear pattern: `Object.fromEntries(#buffer)`, `#buffer.clear()`, then `await #inner.setMany(snapshot)` (skips `setMany` if snapshot is empty)
    - Implement `flush()` — chains onto `#flushInProgress` and returns the new tail promise
    - Implement `dispose()` — calls `clearInterval(#timer)`, does not flush
    - Start `setInterval` in the constructor, chaining each tick onto `#flushInProgress`
    - Implement `coalesceCursorStore(inner, options)` factory — validates `intervalMs` with `Number.isFinite` and `> 0` guard, throws `RangeError` with descriptive message on failure, constructs and returns `CoalescingStore`
    - Add JSDoc on `coalesceCursorStore` documenting the loss window, `flush()` shutdown pattern, and `dispose()` behaviour (Requirements 7.1, 7.2, 7.3)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_

  - [ ]* 1.2 Write property test — Property 1: Invalid `intervalMs` throws `RangeError`
    - **Property 1: Invalid intervalMs throws RangeError**
    - **Validates: Requirements 1.2, 1.3**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate values from `fc.oneof(fc.constant(0), fc.integer({ max: -1 }), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity))`
    - Assert `coalesceCursorStore(inner, { intervalMs })` throws a `RangeError`

  - [ ]* 1.3 Write property test — Property 2: `set` buffers without touching InnerStore
    - **Property 2: set buffers without touching InnerStore**
    - **Validates: Requirements 2.1**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate arbitrary `streamKey` and `cursor` strings
    - After `store.set(streamKey, cursor)`, assert `FakeInnerStore.setManyCalls.length === 0` and `FakeInnerStore.getCalls.length === 0`

  - [ ]* 1.4 Write property test — Property 4: `setMany` buffers all entries without touching InnerStore
    - **Property 4: setMany buffers all entries without touching InnerStore**
    - **Validates: Requirements 2.3**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate a non-empty `fc.dictionary` of safe keys to cursor strings
    - After `store.setMany(entries)`, assert `FakeInnerStore.setManyCalls.length === 0`

- [ ] 2. Implement read pass-through and verify coalescing behaviour via tests
  - [ ] 2.1 Write example-based unit tests for `CoalescingStore` in `packages/pulse-core/test/CoalescingStore.test.ts`
    - Define `FakeInnerStore extends CursorStore` with `store: Map`, `setManyCalls`, `getManyCalls`, `getCalls` arrays (matching design spec)
    - Test: factory throws `RangeError` for `intervalMs` values `0`, `-1`, `NaN`, `Infinity`
    - Test: `set` then `get` returns buffered value without calling `InnerStore.get`
    - Test: multiple `set` calls for same key — only last value retained in buffer
    - Test: `setMany` merges entries into buffer without calling `InnerStore.setMany`
    - Test: `get` for key absent from buffer delegates to `InnerStore.get`
    - Test: `getMany` with mixed buffered/unbuffered keys — buffered values returned directly, remaining keys delegated to `InnerStore.getMany`, results merged
    - Test: `flush()` on empty buffer does not call `InnerStore.setMany`
    - Test: `flush()` drains buffer — calls `InnerStore.setMany` exactly once with all buffered entries, buffer is empty after resolve
    - Test: timer fires after `intervalMs` and calls `InnerStore.setMany` (use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`)
    - Test: timer does not fire after `dispose()`
    - Test: `dispose()` with buffered entries does not flush (entries are discarded)
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3_

  - [ ]* 2.2 Write property test — Property 3: Last-write-wins coalescing
    - **Property 3: Last-write-wins coalescing**
    - **Validates: Requirements 2.2, 3.4**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate a `streamKey` and `fc.array(fc.string({ minLength: 1 }), { minLength: 2 })` of cursor values
    - Call `store.set(streamKey, v)` for each value in sequence
    - Assert `store.get(streamKey)` returns the last value
    - Call `store.flush()` and assert `FakeInnerStore.setManyCalls[0][streamKey]` equals the last value

  - [ ]* 2.3 Write property test — Property 5: `flush` drains buffer to InnerStore exactly once
    - **Property 5: flush drains the buffer to InnerStore exactly once**
    - **Validates: Requirements 3.2, 4.1**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate a non-empty `fc.dictionary` of safe keys to cursor strings
    - Call `store.setMany(entries)`, then `await store.flush()`
    - Assert `FakeInnerStore.setManyCalls.length === 1`
    - Assert the single call contains all entries
    - Assert buffer is empty (verified by a subsequent `flush()` producing no additional `setMany` call)

  - [ ]* 2.4 Write property test — Property 6: `get` serves buffered values without delegating to InnerStore
    - **Property 6: get serves buffered values without delegating to InnerStore**
    - **Validates: Requirements 5.1**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate `streamKey` and `cursor`; call `store.set(streamKey, cursor)`
    - Assert `await store.get(streamKey) === cursor`
    - Assert `FakeInnerStore.getCalls.length === 0`

  - [ ]* 2.5 Write property test — Property 7: `get` delegates to InnerStore for keys absent from buffer
    - **Property 7: get delegates to InnerStore for keys absent from buffer**
    - **Validates: Requirements 5.2**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate `streamKey` and `cursor`; pre-populate `FakeInnerStore.store` with the value
    - Assert `await store.get(streamKey) === cursor`
    - Assert `FakeInnerStore.getCalls` contains `streamKey` exactly once

  - [ ]* 2.6 Write property test — Property 8: `getMany` splits reads between buffer and InnerStore
    - **Property 8: getMany splits reads between buffer and InnerStore**
    - **Validates: Requirements 5.3**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate two disjoint sets of safe keys: `bufferedKeys` (with values in buffer) and `innerKeys` (with values in `FakeInnerStore`)
    - Call `store.getMany([...bufferedKeys, ...innerKeys])`
    - Assert all buffered keys return their buffered values
    - Assert all inner keys return their inner-store values
    - Assert `FakeInnerStore.getManyCalls` contains only `innerKeys` (buffered keys not delegated)
    - Assert no key is omitted from the result

- [ ] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement concurrent flush serialization and export
  - [ ] 4.1 Write property test — Property 9: Concurrent flush serialization — each entry written exactly once
    - **Property 9: Concurrent flush serialization — each entry written exactly once**
    - **Validates: Requirements 4.3**
    - In `packages/pulse-core/test/CoalescingStore.pbt.test.ts`
    - Generate a non-empty `fc.dictionary` of safe keys to cursor strings
    - Use a `FakeInnerStore` with an artificial async delay in `setMany` to simulate an in-progress flush
    - Call `store.setMany(entries)`, then fire both `store.flush()` and a simulated timer tick concurrently (via `Promise.all`)
    - Assert each key appears in `InnerStore.setMany` calls exactly once across all calls (no duplicates, no drops)

  - [ ] 4.2 Export `coalesceCursorStore` and `CoalescingStore` from `packages/pulse-core/src/index.ts`
    - Add `export { coalesceCursorStore, CoalescingStore } from "./coalesceCursorStore.js";`
    - Add `export type { CoalescingStoreOptions } from "./coalesceCursorStore.js";`
    - _Requirements: 1.1, 1.4_

- [ ] 5. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `{ numRuns: 100 }` and are tagged with a comment referencing the design property number
- The `FakeInnerStore` defined in `CoalescingStore.test.ts` should be imported or duplicated in `CoalescingStore.pbt.test.ts` — prefer a shared helper in `test/fakes/` if the project pattern supports it
- Timer-based tests in `CoalescingStore.test.ts` use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` and must call `store.dispose()` in `afterEach` to prevent timer leaks
- Property tests call `flush()` directly and do not rely on the timer, keeping the PBT harness deterministic
- The snapshot-then-clear pattern in `#doFlush` is critical for correctness: clear the buffer *before* awaiting `InnerStore.setMany` so writes arriving during I/O are not lost

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["4.1", "4.2"] }
  ]
}
```
