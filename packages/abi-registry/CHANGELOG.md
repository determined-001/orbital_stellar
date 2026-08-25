# abi-registry Changelog

## [Unreleased]

### Added
- **Semantic taxonomy format** - `schema/taxonomy.schema.json` (JSON Schema 2020-12) is the normative format for community-submitted taxonomy entries mapping raw event topics onto dot-namespaced names (`swap.executed`, `payment.sent`). Naming rules (closed namespace-root list, casing, reserved `engine.*`/`event.*` roots) and the collision policy are documented in the schema's own `description` fields. `validateTaxonomyEntry()` is the runtime equivalent for consumers without a JSON Schema validator; `findTaxonomyConflicts()` implements the machine-checkable half of the collision policy (`duplicate-id`, `ambiguous-mapping`, `duplicate-mapping`, cleared by `supersedes`). Two worked examples ship under `schema/examples/taxonomy/`.
- **`abi-registry verify` CLI** - `abi-registry verify <contractId> --schema <file>` wraps `verifySchema()` as one command, printing the structured verdict as text or `--json`. `--schema` accepts the canonical `ContractSpec` shape or the hand-authored well-known format. Exit codes are distinct per outcome so CI can gate on them: `0` match, `1` mismatch, `2` unverifiable (`--allow-unverifiable` to accept it), `3` usage/IO/RPC error.
- **On-chain registry support** - `OnChainRegistryPublisher` (implements `RegistryPublisher`, publishes specs to the deployed `contracts/registry` Soroban contract) and `OnChainAbiRegistryClient` (resolves specs by reading the registry contract via RPC simulation, verifying the fetched blob's hash against the on-chain `spec_hash`).
- **WASM auto-discovery** - `discoverContractSpec()` fetches a deployed contract's WASM and parses its embedded `contractspecv0` section into a canonical `ContractSpec`, no human-authored JSON required. Throws `NoEmbeddedSpecError` for non-Rust/stripped contracts and for Stellar Asset Contracts (SACs - which have no WASM at all; verified against a live mainnet USDC lookup).
- **Default registry resolution** - `createDefaultAbiRegistryClient()` composes `BundledWellKnownClient` (the four bundled well-known specs, works fully offline) with the on-chain registry once deployed (`ChainedAbiRegistryClient`, `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID`). This is now `@orbital-stellar/pulse-core`'s default when `CoreConfig.abiRegistry` is omitted.
- **Canonical `ContractSpec` typegen** - `generateContractArtifacts`/`generateContractTypes` now accept a canonical `ContractSpec` (not just raw XDR entries), emitting typed function parameter/return declarations and named UDT (struct/enum/union) interfaces alongside the existing event interfaces + Zod schemas.
- `ContractSpec.pointer` field and `canonicalizeSpec()` - deterministic key-sorted JSON serialization, used to hash specs before publishing and to verify fetched blobs against the on-chain hash.
- `wellKnownToContractSpec()` - converts the hand-authored well-known JSON format into the canonical `ContractSpec` shape.
- `PrimitiveType` gained `"error"` - the generic Soroban error-value slot (`scvError`); real and common, since it's how `Result<T, Error>`'s error arm is encoded on the wire regardless of which `#[contracterror]` enum is named (verified against a real soroban-sdk 27 build).
- SEP-41 event definitions (`transfer`, `mint`, `burn`, `clawback`, `set_authorized`, `approve`) added to the bundled well-known specs (`usdc.json`, `eurc.json`, `aqua.json`, `native-asset-wrapper.json` - the native wrapper only gets `transfer`/`approve`, matching its actual function set).

### Fixed
- `schema/spec.schema.json`'s `PrimitiveType` enum was missing `"error"`, so it rejected specs that `spec.ts`'s own `PrimitiveType`/`validateSpec` accept. Caught by a test asserting the taxonomy schema reuses the same scalar set.
- `decodeContractEvent()` now accepts a canonical `ContractSpec` in addition to `XdrContractSpec` - previously only the latter typechecked, even though a `ContractSpec`'s `xdrEntries` made it structurally usable.

### Changed
- `package.json`'s `files` field now includes `schema/` and `specs/well-known/` - previously these were used at runtime (by `LocalFilePublisher`, and now by `BundledWellKnownClient`) via a path relative to the built `dist/` files, but weren't actually included in what gets published to npm, which would have broken for anyone installing this package outside the monorepo.
