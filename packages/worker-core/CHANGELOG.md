# worker-core Changelog

## [Unreleased]

### Added
- Initial package scaffold. `WorkerDefinition`, the `Trigger` discriminated union (`time` | `event` | `computation`), `Schedule` (`interval` | `cron`, both with an explicit `timezone`), and `assertImplementedTrigger`/`TriggerNotImplementedError` for the runtime W0 rejection of the `event` and `computation` trigger kinds. `0.x` - may break in minors per `STABILITY.md`.
- **Copy-trade worker decision logic** (`workers/copyTrade.ts`, `vault/`) - not runnable against a real vault yet; see the README's "Copy-trade worker on the vault pattern" section. `VaultClient` specifies the constrained-function boundary a real vault client must satisfy (`UNIMPLEMENTED_VAULT_CLIENT` throws from every method - 22.1's vault contract does not exist yet). `planCopyTrade` mirrors an observed trade through a `VaultClient`, bounded by `computeMirroredSize`'s position-sizing cap, subscriber revocation, and a ledger-based latency budget, producing either an executed outcome or a named, recorded `CopyTradeSkipReason` - never a silent drop. `createCopyTradeTrigger` reuses the existing `EventTrigger` type rather than adding a second matching path.
