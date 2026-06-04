# Requirements Document

## Introduction

High-throughput Stellar event engines write a cursor after every processed event. Stores such as Postgres and S3 charge per write, making per-event persistence expensive at scale. This feature introduces `coalesceCursorStore`, a write-coalescing wrapper that buffers cursor updates in memory and flushes them to the inner `CursorStore` on a configurable interval. The wrapper is transparent to callers — it implements the same `CursorStore` interface — and exposes a `flush()` method for graceful shutdown. The loss window (events that could be replayed on crash) is bounded by `intervalMs`.

## Glossary

- **CoalescingStore**: The `coalesceCursorStore` wrapper instance that implements `CursorStore` and buffers writes.
- **InnerStore**: The underlying `CursorStore` delegate (e.g., `PostgresCursorStore`, `RedisCursorStore`) that performs the actual durable write.
- **PendingBuffer**: The in-memory map from stream key to the most-recent cursor value that has not yet been flushed to the InnerStore.
- **FlushCycle**: A single execution of the flush logic that drains the PendingBuffer by calling `InnerStore.setMany`.
- **intervalMs**: The maximum number of milliseconds between consecutive FlushCycles for a given stream key.
- **LossWindow**: The interval of time — at most `intervalMs` — during which a crash could cause cursor values held only in the PendingBuffer to be lost, requiring event replay from the last durably persisted cursor.
- **StreamKey**: An opaque string that uniquely identifies a Stellar event stream (e.g., an account address).

## Requirements

### Requirement 1: Coalescing Wrapper Factory

**User Story:** As a pulse-core consumer, I want to wrap any `CursorStore` with write-coalescing behaviour, so that I can reduce the number of durable writes without changing the rest of my engine code.

#### Acceptance Criteria

1. THE `coalesceCursorStore` function SHALL accept an `InnerStore` of type `CursorStore` and an options object containing `intervalMs` as a positive integer, and SHALL return a `CoalescingStore` that satisfies the `CursorStore` interface.
2. WHEN `intervalMs` is less than or equal to zero, THEN THE `coalesceCursorStore` function SHALL throw a `RangeError` with a descriptive message.
3. WHEN `intervalMs` is not a finite number, THEN THE `coalesceCursorStore` function SHALL throw a `RangeError` with a descriptive message.
4. THE `CoalescingStore` SHALL expose a `flush(): Promise<void>` method in addition to the standard `CursorStore` interface.

### Requirement 2: Buffered Write Behaviour

**User Story:** As a pulse-core consumer, I want cursor writes to be buffered in memory, so that only the latest cursor per stream key is written to the InnerStore during each FlushCycle.

#### Acceptance Criteria

1. WHEN `CoalescingStore.set(streamKey, cursor)` is called, THE `CoalescingStore` SHALL store the cursor value in the PendingBuffer under `streamKey` and SHALL return immediately without calling `InnerStore.set`.
2. WHEN `CoalescingStore.set(streamKey, cursor)` is called multiple times for the same `streamKey` before a FlushCycle, THE `CoalescingStore` SHALL retain only the most-recently provided cursor value for that `streamKey` in the PendingBuffer.
3. WHEN `CoalescingStore.setMany(entries)` is called, THE `CoalescingStore` SHALL merge all entries into the PendingBuffer, overwriting any previously buffered value for each `streamKey` present in `entries`, without calling `InnerStore.setMany`.
4. WHILE the PendingBuffer is non-empty and a FlushCycle has not yet occurred, THE `CoalescingStore` SHALL NOT call any write method on the `InnerStore`.

### Requirement 3: Periodic Flush

**User Story:** As a pulse-core consumer, I want buffered cursor writes to be automatically flushed to the InnerStore at a regular interval, so that cursor progress is durably persisted without manual intervention during normal operation.

#### Acceptance Criteria

1. WHEN the `CoalescingStore` is created, THE `CoalescingStore` SHALL schedule a recurring FlushCycle that executes every `intervalMs` milliseconds.
2. WHEN a FlushCycle executes and the PendingBuffer is non-empty, THE `CoalescingStore` SHALL call `InnerStore.setMany` exactly once with all entries currently in the PendingBuffer, then clear those entries from the PendingBuffer.
3. WHEN a FlushCycle executes and the PendingBuffer is empty, THE `CoalescingStore` SHALL NOT call any method on the `InnerStore`.
4. WHEN `n` calls to `CoalescingStore.set` are made for the same `streamKey` within a single `intervalMs` window, THE `CoalescingStore` SHALL issue at most one write to the `InnerStore` for that `streamKey` during the subsequent FlushCycle.

### Requirement 4: Manual Flush for Graceful Shutdown

**User Story:** As a pulse-core consumer, I want to explicitly flush all pending cursor writes before my process exits, so that I do not lose cursor progress on graceful shutdown.

#### Acceptance Criteria

1. WHEN `CoalescingStore.flush()` is called, THE `CoalescingStore` SHALL immediately drain the PendingBuffer by calling `InnerStore.setMany` with all pending entries, then clear the PendingBuffer.
2. WHEN `CoalescingStore.flush()` is called and the PendingBuffer is empty, THE `CoalescingStore` SHALL return without calling any method on the `InnerStore`.
3. WHEN `CoalescingStore.flush()` is called while a scheduled FlushCycle is actively writing to the `InnerStore`, THE `CoalescingStore` SHALL block the manual flush until the in-progress scheduled FlushCycle completes, then proceed to flush any entries that remain in or were added to the PendingBuffer after the scheduled cycle cleared it, ensuring each pending entry is written to the `InnerStore` exactly once.
4. WHEN `CoalescingStore.flush()` resolves, THE `CoalescingStore` SHALL guarantee that all cursor values that were in the PendingBuffer at the time `flush()` was called have been durably handed off to the `InnerStore`.

### Requirement 5: Read Pass-Through

**User Story:** As a pulse-core consumer, I want reads from the CoalescingStore to reflect the latest cursor value, so that the engine always resumes from the correct position even when a write has been buffered but not yet flushed.

#### Acceptance Criteria

1. WHEN `CoalescingStore.get(streamKey)` is called and `streamKey` has a value in the PendingBuffer, THE `CoalescingStore` SHALL return the buffered value without calling `InnerStore.get`.
2. WHEN `CoalescingStore.get(streamKey)` is called and `streamKey` has no value in the PendingBuffer, THE `CoalescingStore` SHALL delegate to `InnerStore.get(streamKey)` and return its result.
3. WHEN `CoalescingStore.getMany(keys)` is called and at least one key is present in the PendingBuffer, THE `CoalescingStore` SHALL return buffered values for those keys and delegate to `InnerStore.getMany` only for the remaining keys absent from the PendingBuffer, merging the results into a single record. WHEN none of the requested keys are present in the PendingBuffer, THE `CoalescingStore` SHALL delegate entirely to `InnerStore.getMany` and return its result.

### Requirement 6: Timer Lifecycle Management

**User Story:** As a pulse-core consumer, I want to be able to stop the CoalescingStore's background timer, so that I can cleanly tear down the store without leaving dangling intervals in my process.

#### Acceptance Criteria

1. THE `CoalescingStore` SHALL expose a `dispose(): void` method that immediately cancels the recurring FlushCycle timer upon invocation.
2. WHEN `CoalescingStore.dispose()` is called, THE `CoalescingStore` SHALL NOT perform any further automatic FlushCycles after the current in-progress cycle (if any) completes.
3. WHEN `CoalescingStore.dispose()` is called without a prior `flush()`, THE `CoalescingStore` SHALL NOT automatically flush the PendingBuffer; any remaining buffered values are discarded.

### Requirement 7: Loss Window Documentation

**User Story:** As a pulse-core consumer, I want the loss window to be clearly documented, so that I can make an informed decision about the `intervalMs` value for my reliability requirements.

#### Acceptance Criteria

1. THE `coalesceCursorStore` function's JSDoc SHALL document that on an unclean process exit, up to `intervalMs` milliseconds of cursor progress may be lost, requiring the engine to replay events from the last durably persisted cursor.
2. THE `coalesceCursorStore` function's JSDoc SHALL document that calling `flush()` before process exit reduces the loss window to zero for all events processed before `flush()` was called.
3. THE `coalesceCursorStore` function's JSDoc SHALL document that `dispose()` cancels the background timer but does NOT flush pending writes.
