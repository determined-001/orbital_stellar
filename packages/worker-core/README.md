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

## Backstop

§C.7's mechanism: when a registered external worker fails to fire, an Orbital
worker catches the miss and triggers the contract.

```ts
import { BackstopWatcher, registerBackstop } from "@orbital-stellar/worker-core";

const registration = registerBackstop({
  subscriptionId: "sub-1",
  workerId: "payroll-w1",
  tier: "time-insensitive",   // latency-sensitive tiers wait for 22.4
  graceLedgers: 5,            // per-subscription, from the manifest's bound
});

const watcher = new BackstopWatcher(registration.subscription, deps);
const outcome = await watcher.evaluate(window, currentLedger);
```

The double-fire race is the central correctness problem, and it is not solved
with timing. The backstop claims **the same window id the primary claims**,
through the same 18.6 store, so the race is decided by one atomic claim rather
than by who noticed first. A primary that fires late — after its deadline but
inside grace — already holds the claim, and the backstop stands down.

`watcher.stats` counts **windows watched**, not only interventions, because the
cost of a backstop is readiness rather than payouts: it scales with
subscriptions, not with failures. Exposed from the start rather than retrofitted
by 21.2, since a cost model added afterwards measures whatever the
implementation happened to do.

## Design notes

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

## No latency tier, and no copy-trade worker

Both used to live here as stubs. Both are gone.

They existed to serve a trading product this package is not. Copy-trading means
mirroring someone else's trades on a subscriber's behalf, which means the worker
moves subscriber funds, which means custody, which is why it needed a vault with
allow-listed pools and slippage bounds. Every step followed from the one before
it; the first step was the mistake.

A worker here calls a function **anyone could have called** and holds nothing.
`contracts/payroll`'s `disburse()` is the reference: it takes no caller
authorization, checks its own conditions, and produces identical results whether
a worker, the owner, a recipient or a stranger fires it. There is no authority
to constrain, so there is nothing for a vault to do.

Issues #1068 (vault), #1070 (copy-trade) and #1071 (latency path) are closed
unbuilt. See [`docs/design/workers.md` §6](../../docs/design/workers.md#the-vault-pattern-was-cut)
for the reasoning, and read it before proposing any of them again.

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
Worker layer primitives: triggers that hold no authority over the funds they move.

> **Status: partial.** This package currently ships the transaction builder and
> submitter (#1040). The package scaffold and the full worker definition model
> are #1038's deliverable; `src/types.ts` carries a provisional
> `WorkerDefinition` covering only the fields the submitter reads, so it can be
> replaced by a type import once #1038 lands.

## What the submitter does

`TxSubmitter` turns a due worker decision into a signed, submitted Soroban
invocation:

1. **Builds** an `InvokeHostFunction` operation from the worker's contract ID,
   function name and already-encoded arguments.
2. **Simulates** it through `@orbital-stellar/pulse-core`'s `SorobanRpcClient` -
   the same RPC client the rest of the repo uses, not a second client layer.
3. **Prices** it from that simulation's `minResourceFee`, padded by a bounded
   multiplier and checked against a configured ceiling (see below).
4. **Signs** with the operator's own key, and only that key.
5. **Submits**, then **confirms by polling** `getTransaction` - a successful
   send is never taken as a successful invocation.

```ts
import { OperatorSigner, TxSubmitter } from "@orbital-stellar/worker-core";
import { SorobanRpcClient } from "@orbital-stellar/pulse-core";
import { Networks } from "@stellar/stellar-sdk";

const submitter = new TxSubmitter({
  client: new SorobanRpcClient({ url: process.env.SOROBAN_RPC_URL! }),
  signer: OperatorSigner.fromEnv({ networkPassphrase: Networks.TESTNET }),
  networkPassphrase: Networks.TESTNET,
  loadAccount: (accountId) => horizon.loadAccount(accountId),
  feeMultiplier: 1.5,
  maxFeeStroops: 5_000_000,
});

const outcome = await submitter.submit(worker);
```

## Outcomes

`submit` does not throw for anything a caller is expected to handle:

| `outcome.status` | Meaning |
|---|---|
| `submitted` | The transaction landed in a ledger. Carries the hash, ledger and the fee actually signed for. |
| `contract_rejected` | The contract refused the call - e.g. a permissionless `disburse()` saying "not yet due". **This is the design working, not a miss.** |
| `failed` | Infrastructure, fee-cap or on-chain failure, with `retryable` saying whether trying again could help. |

`contract_rejected` is deliberately its own status so downstream scoring does
not count a correct refusal as a missed trigger.

## Fees are always bounded

An uncapped fee on a congested ledger is how an operator drains its own XLM
float. `resolveFee` pads the simulated resource fee by `feeMultiplier`
(default 1.5, hard ceiling 10) and refuses anything above `maxFeeStroops`
(default 10,000,000 stroops = 1 XLM) with a `FeeCapExceededError`. A capped-out
submission comes back as a retryable `failed` outcome - nothing is signed and
nothing is sent.

## One key, and only one

`OperatorSigner` wraps exactly one keypair - the operator's. A worker triggers a
permissionless call; it never holds authority over a subscriber's funds, so it
never needs a subscriber's key. The type is shaped so that giving it one cannot
be a quiet change: the keypair is private, `sign` takes no signer argument, and
`TxSubmitter` accepts a signer rather than a list of them. Adding a second
signer means changing this shape, which is an obvious diff in review.

The seed is read through `pulse-core`'s `secretPolicy` helpers, is never logged
(`toString`/`toJSON`/`describe` all render the public key), and never appears in
an error message - not even a prefix. `ORBITAL_OPERATOR_SECRET` is covered by
`scripts/assert-no-secrets-in-bundle.mjs`.
