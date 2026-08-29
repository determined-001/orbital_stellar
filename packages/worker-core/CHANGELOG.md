# worker-core Changelog

## [Unreleased]

### Added
- Initial package scaffold. `WorkerDefinition`, the `Trigger` discriminated union (`time` | `event` | `computation`), `Schedule` (`interval` | `cron`, both with an explicit `timezone`), and `assertImplementedTrigger`/`TriggerNotImplementedError` for the runtime W0 rejection of the `event` and `computation` trigger kinds. `0.x` - may break in minors per `STABILITY.md`.
- **Price and slippage guard rails** (`guards/priceGuard.ts`, `guards/circuitBreaker.ts`) - `checkStaleness`, `checkDeviation`, and `checkPriceGuard` for fixed-point, dual-source price validation before a worker acts on a reading; `CircuitBreaker` for halting a worker after N consecutive guard trips, requiring a documented manual re-enable. On-chain enforcement (the vault side of the split) is specified but not implemented - see `docs/design/worker-guard-rails.md`; it depends on the vault contract from 22.3, which does not exist in this repo yet.
