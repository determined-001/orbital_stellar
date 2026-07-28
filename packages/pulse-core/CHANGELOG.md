# pulse-core Changelog

## [Unreleased]

### Breaking Changes
- **`CoreConfig.abiRegistry` now defaults to an active registry client instead of `undefined`.** Previously, omitting `abiRegistry` meant no ABI lookup ever happened and `contract.emitted` events were dispatched synchronously. Now, omitting it resolves `@orbital-stellar/abi-registry`'s bundled well-known specs (USDC, EURC, AQUA, the native XLM wrapper) by default - and, once Orbital's on-chain registry contract is deployed, that too. This means:
  - `decodedData` now populates automatically for those well-known contracts with zero configuration.
  - `contract.emitted` event delivery is now **always asynchronous** (a microtask hop through the registry lookup), even for contracts the registry doesn't recognize - previously, delivery was synchronous whenever no `abiRegistry` was configured.
  - Pass `abiRegistry: false` to opt out entirely and preserve the exact pre-upgrade behavior (`decodedData` always `undefined`, synchronous delivery).

### Fixed
- **`decodedData` now contains the actually-decoded event payload**, not the raw ABI spec. Previously, `EventEngine.route()` set `decodedData` to the looked-up spec (or its raw XDR `entries`) instead of calling `@orbital-stellar/abi-registry`'s `decodeContractEvent()` against it - meaning every existing consumer configuring `abiRegistry` was silently getting the wrong thing on `contract.emitted` events. This was a bug, not a documented behavior; fixing it does change the shape of `decodedData` for anyone relying on the old (incorrect) output.

### Added
- `orbital typegen <contractId>` CLI command - generates TypeScript interfaces + Zod schemas for a deployed Soroban contract, resolving its spec from the on-chain registry first and falling back to live WASM auto-discovery.
- **`ContractEmittedEvent.semantic`** - populated from `@orbital-stellar/abi-registry`'s new `TaxonomyResolver` once `decodedData` resolves successfully (contract exposes `decoded.functionName` as the resolver's `eventTopic`). New `CoreConfig.taxonomy` option, mirroring `abiRegistry`'s shape: an explicit resolver, `false` to opt out (`semantic` always `undefined`), or omit it to default to the bundled `wellKnownTaxonomy`. Resolution never throws and never blocks `decodedData`/dispatch - a failure is logged and swallowed. `semantic` is only ever set when a mapping actually resolves, never guessed.

## [0.1.0] - 2026-05-28

### Breaking Changes
- **WatcherNotification API**: The `timestamp` field on `WatcherNotification` (`engine.reconnecting` and `engine.reconnected` events) has been renamed to `emittedAt` to distinguish it from the on-chain `created_at` timestamp used in other events like `payment.received`.

See the root [`CHANGELOG.md`](../../CHANGELOG.md) for the full `v0.1.0` release notes across all packages.
