# Requirements Document

## Introduction

Multi-source engines (e.g., engines watching multiple Stellar addresses simultaneously) update cursors for several stream keys near-simultaneously — one `set` call per event source. The current `CursorStore` interface exposes only single-key operations (`get` / `set`), which means N concurrent events produce N round-trips to the backing store. This feature extends `CursorStore` with optional batch operations (`getMany` / `setMany`) so that adapters capable of batching (Postgres, Redis) can do so efficiently, while adapters that do not override the batch methods fall back transparently to the existing single-key operations.

## Glossary

- **CursorStore**: The pluggable interface in `packages/pulse-core/src/CursorStore.ts` that persists and retrieves stream cursors.
- **Adapter**: A concrete class that implements `CursorStore` (e.g., `PostgresCursorStore`, `RedisCursorStore`, an in-memory store).
- **Stream_Key**: A string identifier for a single Horizon or Soroban event stream whose cursor position is being tracked.
- **Cursor**: An opaque string (e.g., a Horizon paging token) that marks the last-processed position in a stream.
- **Batch_Operation**: A single call that reads or writes multiple stream keys in one network or database round-trip.
- **Default_Implementation**: The fallback logic provided directly on the `CursorStore` abstract base class that delegates `getMany` / `setMany` to repeated `get` / `set` calls when an adapter does not override the batch methods.
- **Efficient_Implementation**: An adapter-level override of `getMany` / `setMany` that uses a single database or cache query (e.g., a multi-row `SELECT`, a Redis `MGET`/`MSET`) instead of N individual queries.
- **RedisLike**: A minimal interface that any Redis client must satisfy to be used with `RedisCursorStore`, requiring at minimum: `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<unknown>`, `mget(...keys: string[]): Promise<(string | null)[]>`, and `mset(...args: (string)[]): Promise<unknown>`.

## Requirements

### Requirement 1: Extend CursorStore Interface with Optional Batch Methods

**User Story:** As a pulse-core consumer, I want `CursorStore` to expose `getMany` and `setMany` methods, so that I can read and write multiple cursors in a single call without changing existing adapter code.

#### Acceptance Criteria

1. THE `CursorStore` abstract base class SHALL declare a `getMany(keys: string[]): Promise<Record<string, string | null>>` method with a default implementation, so that subclasses are not required to override it.
2. THE `CursorStore` abstract base class SHALL declare a `setMany(entries: Record<string, string>): Promise<void>` method with a default implementation, so that subclasses are not required to override it.
3. WHEN `getMany` is called with an empty array, THE `CursorStore` SHALL resolve with an empty object `{}`.
4. WHEN `setMany` is called with an empty object, THE `CursorStore` SHALL resolve with `void`.
5. WHEN an existing adapter implements only `get` and `set`, THE adapter SHALL satisfy the `CursorStore` contract and calls to `getMany` and `setMany` SHALL resolve successfully via the default implementation without requiring any changes to the adapter.
6. WHEN `getMany` is called with a key that has no stored cursor, THE `CursorStore` SHALL include that key in the result record mapped to `null`.

### Requirement 2: Default Implementations Delegate to Single-Key Operations

**User Story:** As an adapter author, I want `getMany` and `setMany` to have default implementations that delegate to `get` and `set`, so that I do not need to implement batch logic unless I choose to optimize.

#### Acceptance Criteria

1. WHEN an adapter does not override `getMany`, THE `CursorStore` default implementation SHALL call `get` once per key in the provided array sequentially and aggregate the results — including `null` values returned by `get` — into a `Record<string, string | null>`.
2. WHEN an adapter does not override `setMany`, THE `CursorStore` default implementation SHALL call `set` once per entry in the provided `Record<string, string>` sequentially.
3. THE Default_Implementation SHALL preserve the key-to-value mapping: for each key `k` in the input array, the returned record SHALL contain `k` mapped to the value returned by `get(k)`, or `null` if `get(k)` returns `null`.
4. IF a delegated `get` or `set` call throws an error during default `getMany` or `setMany` execution, THE Default_Implementation SHALL allow the error to propagate to the caller without suppressing it.
5. WHEN `getMany` is called with an empty array or `setMany` is called with an empty object, THE Default_Implementation SHALL resolve immediately without calling `get` or `set`.

### Requirement 3: PostgresCursorStore Implements Efficient Batch Operations

**User Story:** As an operator running a multi-source engine backed by Postgres, I want `PostgresCursorStore` to use a single query for batch reads and a single upsert for batch writes, so that N simultaneous cursor updates produce one database round-trip instead of N.

#### Acceptance Criteria

1. WHEN `getMany` is called with N keys on `PostgresCursorStore`, THE `PostgresCursorStore` SHALL execute exactly one SQL query to retrieve all matching rows.
2. WHEN `setMany` is called with N entries on `PostgresCursorStore`, THE `PostgresCursorStore` SHALL execute exactly one SQL upsert statement to persist all entries, overwriting any existing cursor value for each key (last-write-wins, consistent with the single-key `set` behavior).
3. WHEN `getMany` is called and a key has no stored cursor, THE `PostgresCursorStore` SHALL return `null` for that key in the result record.
4. WHEN `getMany` is called with an empty array, THE `PostgresCursorStore` SHALL return `{}` without executing any SQL query.
5. WHEN `setMany` is called with an empty object, THE `PostgresCursorStore` SHALL return without executing any SQL query.
6. WHEN `setMany` is called with a non-empty set of entries and those same keys are subsequently read via `getMany`, THE `PostgresCursorStore` SHALL return the values that were written without any transformation.
7. IF the underlying database query throws an error during `getMany` or `setMany`, THE `PostgresCursorStore` SHALL allow the error to propagate to the caller without suppressing it.

### Requirement 4: RedisCursorStore Implements Efficient Batch Operations

**User Story:** As an operator running a multi-source engine backed by Redis, I want a `RedisCursorStore` adapter that uses `MGET` and `MSET` (or equivalent pipeline) for batch reads and writes, so that N simultaneous cursor updates produce one Redis round-trip instead of N.

#### Acceptance Criteria

1. THE `RedisCursorStore` SHALL implement the `CursorStore` interface including `get`, `set`, `getMany`, and `setMany`, all delegating to the injected `RedisLike` client.
2. WHEN `getMany` is called with N keys on `RedisCursorStore`, THE `RedisCursorStore` SHALL retrieve all values in a single network round-trip (e.g., via `MGET` or a single pipeline), not via N individual `GET` commands.
3. WHEN `setMany` is called with N entries on `RedisCursorStore`, THE `RedisCursorStore` SHALL persist all entries in a single network round-trip (e.g., via `MSET` or a single pipeline), not via N individual `SET` commands.
4. WHEN `getMany` is called and a key has no stored cursor, THE `RedisCursorStore` SHALL return `null` for that key in the result record.
5. WHEN `getMany` is called with an empty array, THE `RedisCursorStore` SHALL return `{}` without issuing any Redis command.
6. WHEN `setMany` is called with an empty object, THE `RedisCursorStore` SHALL return without issuing any Redis command.
7. WHEN `setMany` is called with a non-empty set of entries and those same keys are subsequently read via `getMany`, THE `RedisCursorStore` SHALL return the values that were written without any transformation or encoding change.
8. THE `RedisCursorStore` SHALL accept a `RedisLike` interface in its constructor rather than a concrete Redis client class, so that consumers can inject any compatible client (e.g., `ioredis`, `node-redis`). The minimum required methods are: `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<unknown>`, `mget(...keys: string[]): Promise<(string | null)[]>`, and `mset(...args: string[]): Promise<unknown>`.
9. IF the underlying Redis client throws an error during `get`, `set`, `getMany`, or `setMany`, THE `RedisCursorStore` SHALL allow the error to propagate to the caller without suppressing it.

### Requirement 5: Adapters Without Batch Overrides Fall Back Transparently

**User Story:** As a pulse-core consumer using a custom adapter that only implements `get` and `set`, I want calls to `getMany` and `setMany` to work correctly via the default fallback, so that I do not need to update my adapter to use the batch API.

#### Acceptance Criteria

1. WHEN a custom adapter implements only `get` and `set` and `getMany` is called, THE `CursorStore` Default_Implementation SHALL return a record where each key maps to the value returned by `get(key)`, or `null` if `get(key)` returns `null`.
2. WHEN a custom adapter implements only `get` and `set` and `setMany` is called, THE `CursorStore` Default_Implementation SHALL call `set(key, value)` for each entry in the provided record, and SHALL propagate any error thrown by `set` to the caller.
3. THE `CursorStore` abstract base class SHALL NOT declare `getMany` or `setMany` as abstract methods, so that adapters implementing only `get` and `set` compile and function correctly without modification.

### Requirement 6: Batch Methods Are Exported from pulse-core Public API

**User Story:** As a consumer of the `@orbital/pulse-core` package, I want `getMany` and `setMany` to be part of the exported `CursorStore` type, so that I can use them without importing internal modules.

#### Acceptance Criteria

1. THE `@orbital/pulse-core` package SHALL export the updated `CursorStore` abstract base class — including the `getMany(keys: string[]): Promise<Record<string, string | null>>` and `setMany(entries: Record<string, string>): Promise<void>` method signatures — from its public `index.ts`, without removing any previously exported symbols.
2. THE `@orbital/pulse-core` package SHALL export the `RedisCursorStore` class and the `RedisLike` interface (as defined in the Glossary) from its public `index.ts` as named exports.
3. WHEN a consumer imports `CursorStore` from `@orbital/pulse-core`, THE imported type SHALL include `getMany` and `setMany` method signatures resolvable by the TypeScript compiler without requiring any additional imports.
