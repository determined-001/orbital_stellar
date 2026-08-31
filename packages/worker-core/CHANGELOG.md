# worker-core Changelog

## [Unreleased]

### Added
- Initial package scaffold. `WorkerDefinition`, the `Trigger` discriminated union (`time` | `event` | `computation`), `Schedule` (`interval` | `cron`, both with an explicit `timezone`), and `assertImplementedTrigger`/`TriggerNotImplementedError` for the runtime W0 rejection of the `event` and `computation` trigger kinds. `0.x` - may break in minors per `STABILITY.md`.
