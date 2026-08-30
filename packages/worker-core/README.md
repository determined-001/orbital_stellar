# @orbital-stellar/worker-core

## The constraint this package exists to enforce

**A worker's trigger is not a custodian.** A worker definition describes *when*
to submit a transaction and *what* it invokes; it never describes *how to act
as* the account that authorizes it. Concretely:

- `WorkerDefinition.operator` is a public key. The definition names whose
  authority a submission uses - it never holds a way to exercise that
  authority itself.
- There is no field anywhere in this model that can carry a user's secret key,
  a signer, or any other credential. Signing a worker's transaction is the
  submitter's responsibility (18.5), scoped to the operator's own account, and
  happens downstream of everything this package defines.
- If some future capability seems to need key material on a `WorkerDefinition`
  or a `Trigger`, that need is a design bug in whatever wants it - not a gap
  in this type to fill in.

This is the working formulation of §C.2 for this package. The full
architecture-decision record — all four rules in precedence order, the fixed
W0 → W4 build order, the frozen non-goals, and two corrections that must not be
re-litigated — is
**[`docs/design/workers.md`](../../docs/design/workers.md): the trigger is not
the custodian.**

It is not background reading. It carries the review rule this package is
maintained by:

> If a proposed worker needs signing authority to do its job, the design is the
> bug — not the worker.

A change that gives a worker authority over user funds is rejected on that basis
alone, however convenient it is. Prior art and competitive notes are kept
separately in
[`docs/design/prior-art-workers.md`](../../docs/design/prior-art-workers.md),
because they date fast and are self-reported rather than audited.

```bash
pnpm add @orbital-stellar/worker-core
```

## What it does

`worker-core` defines what a worker *is*, before anything runs one. A worker
is an off-chain process that submits a transaction invoking a Soroban contract
function when a condition becomes true. This package is that type model:

- **`WorkerDefinition`** - id, operator, target contract, function name, a
  pure argument builder, trigger, network, and an optional fee-bump policy.
- **`Trigger`** - a discriminated union over `time` | `event` | `computation`.
  Only `time` executes in W0; `event` and `computation` exist as types now so
  that 19.x-22.x extend this union instead of reshaping it, and are rejected
  at runtime by `assertImplementedTrigger` until W2.
- **`Schedule`** - `interval` or `cron`, both with an explicit `timezone` so a
  schedule's execution times don't depend on where the worker happens to run.

Nothing in this package runs a worker. Execution, submission, and signing are
later packages in the 18.x-22.x series; this is the shared vocabulary they
build on.

## Quickstart

```ts
import type { WorkerDefinition, ChainState } from "@orbital-stellar/worker-core";
import { assertImplementedTrigger } from "@orbital-stellar/worker-core";

const worker: WorkerDefinition<[string, bigint]> = {
  id: "payroll-disburse-daily",
  operator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  targetContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  functionName: "disburse",
  buildArgs: (state: ChainState) => ["GBENEFICIARY...", BigInt(state.ledgerSequence)],
  trigger: {
    kind: "time",
    schedule: { kind: "cron", expression: "0 0 * * *", timezone: "UTC" },
  },
  network: "testnet",
};

// Every submission path validates the trigger before acting on it - `event`
// and `computation` triggers throw until W2.
assertImplementedTrigger(worker.trigger);
```

## API

### `WorkerDefinition<TArgs>`

The full definition of a worker: `id`, `operator`, `targetContractId`,
`functionName`, `buildArgs`, `trigger`, `network`, and an optional `feeBump`.

### `ArgBuilder<TArgs>` / `ChainState`

`buildArgs` must be a pure function of `ChainState` - same ledger snapshot in,
same arguments out, no ambient reads. That reproducibility is what lets 19.1's
verification reconstruct a worker's submission from the ledger alone.

### `Trigger`, `Schedule`

`Trigger` is `TimeTrigger | EventTrigger | ComputationTrigger`. `Schedule` (used
by `TimeTrigger`) is `IntervalSchedule | CronSchedule`, both carrying a required
`timezone`.

### `assertImplementedTrigger(trigger)` / `TriggerNotImplementedError`

Narrows a `Trigger` to `TimeTrigger`, throwing `TriggerNotImplementedError` for
`event` and `computation` triggers. Call this before acting on any `Trigger`.

## Latency-sensitive tier (`hotPath/`, `backstop/tiers.ts`) - stub, not wired up

> **This is a standalone stub, not a working hot path.** Issue #1071 (22.4)
> depends on #1064 (21.3, tier configuration) and #1070 (22.3, the copy-trade
> worker), both open. There is no submitter, RPC/simulation layer, or real
> tier-configuration system to plug into yet. What ships here is the
> structural safety boundary the acceptance criteria ask for, with everything
> gated shut - not a usable execution path. `assertHotPathReady` throws
> unconditionally.

§C.7: for copy-trading and liquidations, "late" means the opportunity is gone,
and catching the miss costs the same as running primary infrastructure - so
this tier is worth building only once its cost is actually measured, not
promised.

- **`HotPathPlan`** (`StaticHotPathPlan | DynamicHotPathPlan`) - the
  pre-signing boundary is structural, not a judgment call: only a
  `StaticHotPathPlan` (fixed `args`, nothing left to observe) is ever
  pre-signable; a `DynamicHotPathPlan` (an `ArgBuilder`, evaluated against
  chain state at submission time) never is. `isPreSignable(plan)` narrows on
  this.
- **`LatencyScorecardEntry`** / `recordScorecardEntry(...)` - the "measured
  end to end, published on the scorecards" shape: condition observed to
  transaction submitted, in a declared ledger budget (`LatencyBudget`), with
  `latencyMs`/`withinBudget` derived rather than caller-supplied.
- **`TierEnableDecision`** / `LATENCY_SENSITIVE_TIER_DEFAULT` /
  `assertTierEnableDecisionIsValid` (in `backstop/tiers.ts`) - "enabling the
  tier is a documented, reversible operational decision": who decided, when,
  why, and (once `enabled` is true) a required `CostMeasurement` from 21.2.
  The shipped default is disabled, with an unset decider and a rationale
  naming the unimplemented dependencies. `reversible` is a literal `true` -
  a decision that claims to be irreversible does not type-check.

**Backpressure**: this module does not define its own queue.
`packages/pulse-core/src/EventEngine.ts` already implements bounded-queue
backpressure (`CoreConfig.queue`, the `engine.backpressure` notification) -
per the acceptance criteria, a real hot-path submitter must observe
conditions through that existing mechanism, not a parallel one. This package
has no dependency on `pulse-core` yet because there is no real consumer of
one here; that dependency belongs to the real implementation.
## Copy-trade worker on the vault pattern (`workers/copyTrade.ts`, `vault/`)

> **Decision logic only - not runnable against a real vault yet.** This
> issue (22.3) is explicitly "the last thing built in the entire backlog,
> deliberately," and depends on five other open issues: 22.2 (vault audit),
> 22.1 (the vault contract itself - `contracts/vault` does not exist in this
> repo), 20.6 (event triggers), 21.5 (regulatory framing), and 19.1
> (verification). What ships here is the skip/execute decision logic a real
> copy-trade worker runs, built against the `VaultClient` interface below and
> exercised in tests against a fake implementation - never against a real
> vault.

§C.1's reference trade-like worker: a whale trade is observed, and the action
is mirrored to subscribers, executed **strictly through the vault** - this
module's authority never exceeds "call a constrained function." Nothing in
`workers/copyTrade.ts` holds a signer, a secret, or a balance; the only thing
it can do to a vault is read its subscriber-set `VaultConfig` and request one
`VaultExecutionRequest`.

### `VaultClient` / `UNIMPLEMENTED_VAULT_CLIENT`

`VaultClient` (in `vault/`) is the specification a real vault-calling client
must satisfy once 22.1 ships: `getConfig(vaultId)` and `execute(request)`.
There is deliberately no deposit/withdraw/arbitrary-call method - a worker
needing one has exceeded the constrained-function boundary. The only value of
this type shipped here, `UNIMPLEMENTED_VAULT_CLIENT`, throws
`VaultNotImplementedError` from every method.

### `createCopyTradeTrigger(sourceAccount, asset)`

Builds an `EventTrigger` (the existing trigger type from this package, not a
bespoke shape) for watching a source account's trades on an asset -
implementation note 3: "Reuse 20.6's event trigger for the observation side -
do not add a second matching path." Not runtime-usable until 20.6 implements
event matching.

### `computeMirroredSize(observed, vaultConfig, mirrorRatioBps)`

Mirrors the observed trade proportionally, capped at
`vaultConfig.maxPositionSizeRaw` - "position sizing is bounded by vault
configuration the subscriber set."

### `planCopyTrade(observed, config, mirrorRatioBps, currentLedgerSequence, nowUnix)`

Decides, for one observed trade, whether to mirror it through the vault or
skip it with a named reason - implementation note 1: "skips are a normal,
expected outcome here and must be first-class in the record." Every skip is
recorded (`CopyTradeSkipRecord`) and handed to an optional `onSkip` callback,
never silently dropped. Skip reasons: `asset_not_allow_listed`,
`pool_not_allow_listed`, `position_size_zero_after_bound`,
`slippage_reverted` (a vault-contract revert - the constraint working, not a
miss), `subscriber_revoked`, `latency_budget_exceeded`. Checks run cheapest
and most decisive first: the latency budget and subscriber revocation are
checked before the vault is consulted for a trade at all.
## Price and slippage guard rails (`guards/`)

Trade automation reads prices, and a price source is an attack surface. These
guards run before a worker builds a transaction - they sit in front of the
vault's on-chain slippage bound, not in place of it. The full on-chain/
off-chain split is documented in
[`docs/design/worker-guard-rails.md`](../../docs/design/worker-guard-rails.md);
the short version is: **on-chain where the contract can check it itself,
off-chain as a pre-filter everywhere, and off-chain only for the circuit
breaker**, which is inherently worker-process state.

### `checkStaleness(reading, bound, nowUnix)` / `checkDeviation(a, b, bound)` / `checkPriceGuard(primary, secondary, config, nowUnix)`

`PriceReading` is fixed-point (`price: bigint`, `decimals: number`), not a
`number` - float arithmetic has no place in a check meant to catch a
manipulated price. `checkStaleness` rejects a reading older than
`bound.maxAgeSeconds`, and rejects a future-timestamped reading rather than
treating it as fresher-than-fresh. `checkDeviation` compares two
independently-sourced readings and rejects the pair past
`bound.maxDivergenceBps` - symmetric regardless of argument order, and there
is no single-reading code path, by design (avoiding a single-source
dependency, §C.8). `checkPriceGuard` runs both: staleness on both readings,
then deviation, so a stale reading is rejected before its value is compared
to anything.

### `CircuitBreaker`

Tracks consecutive guard trips per worker. Trips `open` after
`maxConsecutiveTrips` consecutive `recordTrip` calls; a clean
`recordSuccess()` resets the counter while closed. Once open, it stays open -
`manualReenable(reenabledBy, reenabledAtUnix, rationale)` is the only way to
close it, deliberately: an automatic reset would re-enter the exact condition
that tripped it. Every trip (`getTrips()`) and every re-enable
(`getReenables()`) is recorded for the scorecard, and an optional `onTrip`
callback is the seam a real deployment uses to notify an operator.

> **On-chain half not yet built.** Issue 22.5 depends on 22.3 (the
> copy-trade/vault worker), and `contracts/vault` does not exist in this repo
> yet - see `docs/design/worker-guard-rails.md` for what that contract must
> enforce once it does.

## Stability

This package is `0.x` and may break in minors until it reaches `1.0.0` - see
[`STABILITY.md`](../../STABILITY.md) at the repo root.

## License

MIT
Worker-side verification backfill and long-range replay substrate over CDP /
Galexie ledger exports.

Orbital operates **no ledger store of its own** (design doc §B.5): historical
ledgers are read from an external export and discarded; only derived verdicts
are written.

## Operator reputation scoring (`reputation/`)

The version-stamped `0..1000` operator reputation score, derived purely from
chain-derived verdict records. New operators with insufficient history receive
`insufficient_data` — never a default score.

```ts
import { scoreOperator, SCORE_FORMULA_VERSION, type Verdict } from "@orbital-stellar/worker-core";

const verdicts: Verdict[] = /* chain-derived verdict records */ [];

const result = scoreOperator(verdicts, "operator-id", {
  formulaVersion: SCORE_FORMULA_VERSION,
  windowMs: 30 * 86_400_000,
  halfLifeMs: 7 * 86_400_000,
  minSamples: 20,
  latencyTargetMs: 2000,
}, Date.now());

if (result.status === "insufficient_data") {
  // operator has not earned enough verdicts yet
} else {
  console.log(result.score, result.contributors);
}
```

The formula and worked example are in
[`docs/design/worker-reputation.md`](../../docs/design/worker-reputation.md).

## What's here

- `exports/` — the shared **export reader** (`ExportReader` + `ExportSource`).
  One reader, two consumers: verification backfill (#1054) and long-range replay
  (#920). Ships `FileExportSource` (Galexie/CDP JSONL) and `MemoryExportSource`.
- `verification/canonical.ts` — the canonical `VerificationEvent` model and the
  **single** operation→event mapper shared by the export and live paths.
- `verification/verdict.ts` — `computeVerdict`, the **single** deterministic
  scoring function. Its `fingerprint` is byte-identical for export- and
  RPC-sourced inputs over the same range.
- `verification/backfill.ts` — `BackfillRunner`: resumable (checkpointed),
  idempotent (keyed upsert), marks verdicts `source: "backfill"`.
- `verification/liveVerifier.ts` — live path adapter that calls the same
  `computeVerdict`.
- `verification/stores.ts` — `VerdictSink` / `CheckpointStore`
  (in-memory + file).

## Quick start

```ts
import {
  BackfillRunner,
  ExportReader,
  FileExportSource,
  FileVerdictSink,
  FileCheckpointStore,
} from "@orbital-stellar/worker-core";

const reader = new ExportReader(
  new FileExportSource({ directory: "/exports/ledgers", format: "galexie" }),
);

const result = await new BackfillRunner({
  reader,
  range: { startLedger: 10_000_000, endLedger: 11_000_000 },
  windowSize: 1000,
  sink: new FileVerdictSink("/verdicts"),
  checkpoint: new FileCheckpointStore("/verdicts"),
  subjects: ["GABC...", "CDEF..."], // or omit to score every address
}).run();

// result.provenance states where the data was read from.
console.log(result.provenance);
```

See `docs/design/worker-verification-backfill.md` for the full design, the
byte-identical guarantee, and the cost model.
