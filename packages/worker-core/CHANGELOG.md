# worker-core Changelog

## [Unreleased]

### Added
- Initial package scaffold. `WorkerDefinition`, the `Trigger` discriminated union (`time` | `event` | `computation`), `Schedule` (`interval` | `cron`, both with an explicit `timezone`), and `assertImplementedTrigger`/`TriggerNotImplementedError` for the runtime W0 rejection of the `event` and `computation` trigger kinds. `0.x` - may break in minors per `STABILITY.md`.
- **Latency-sensitive tier stub** (`hotPath/`, `backstop/tiers.ts`) - not a working hot path; see the README's "Latency-sensitive tier" section. `HotPathPlan` (`StaticHotPathPlan | DynamicHotPathPlan`) makes the pre-signing safety boundary structural rather than a per-call judgment call (`isPreSignable`); `LatencyScorecardEntry`/`recordScorecardEntry` is the "measured end to end, published on the scorecards" shape; `TierEnableDecision`/`LATENCY_SENSITIVE_TIER_DEFAULT`/`assertTierEnableDecisionIsValid` require a documented, reversible enable decision backed by a `CostMeasurement`, shipped disabled. `assertHotPathReady` throws unconditionally - #1064 (21.3) and #1070 (22.3), and a real submitter, do not exist yet.
