# Backstop readiness cost model

**Status: implemented, except the numbers.** `packages/worker-core` landed with
18.3 ([#1038](https://github.com/determined-001/orbital_stellar/issues/1038)),
which was one of the two blockers; the meter, the aggregation and the export
surfaces now ship in `packages/worker-core/src/backstop/costMeter.ts` and
`packages/worker-core/src/metrics.ts`.

The other blocker stands. 21.1
([#1062](https://github.com/determined-001/orbital_stellar/issues/1062)) is still
open, so no backstop watcher has run and **[the numbers table](#the-measured-numbers)
is still empty on purpose.** §C.7's whole point is that readiness cost must be
measured rather than assumed; filling that table with plausible estimates would
defeat the criterion it exists to satisfy. Everything needed to fill it is now
built and tested — see [How to fill it](#how-to-fill-it).

## Why readiness cost is the number that matters

§C.7 is explicit: model the readiness cost before pricing, because it is not
pure margin. **Monitoring cost scales with the number of backstopped
subscriptions regardless of how many ever need intervention.** A tier priced off
intervention frequency prices the rare event and gives away the common one.

Without this, the pricing page in 21.3 is a guess, and the product's margin is
discovered in a monthly bill.

## What is metered

Four cost drivers, attributed per subscription per window.

| Driver | Unit | Attribution |
| --- | --- | --- |
| RPC calls | count, by method | Direct where a call serves one subscription; shared calls split per [below](#shared-monitoring) |
| Export scans | count and bytes scanned | Direct or shared, same rule |
| Compute | milliseconds of watcher CPU | Sampled per evaluation, attributed to the subscription evaluated |
| Storage | byte-ledgers (bytes × windows retained) | Direct — coverage records and watcher state are per subscription |

A window is the watcher's evaluation window, so cost buckets line up exactly with
coverage windows and the two can be joined without interpolation.

## <a id="shared-monitoring"></a>Shared monitoring is the whole shape of the curve

Implementation note 3: shared monitoring across subscriptions watching the same
condition is the main lever — **and it must be measured before it is optimised.**

It is also what makes attribution non-trivial. One RPC call can serve N
subscriptions watching the same contract. Two ways to attribute it:

- **Even split** (`1/N` each) — every subscription's attributed cost falls as the
  cohort grows. Flatters the marginal number.
- **Full cost to each** — attributed cost is stable per subscription but total
  attributed exceeds total incurred, which makes the aggregate meaningless.

**Neither alone.** The meter records both: `attributedCost` (even split, sums to
actual spend) and `standaloneCost` (what this subscription would cost with no
sharing). The gap between them *is* the value of sharing, expressed as a number
rather than an intuition, and pricing needs both — one for margin, one to know
what happens to a subscription that ends up alone on its condition.

## Marginal cost, not just total

Implementation note 2. Total cost hides the shape of the curve, and the shape is
what decides whether the tier is viable at scale.

Reported explicitly as: the cost of adding one more backstopped subscription,
computed as the delta in total attributed cost across a window in which the
subscription count changed, segmented by whether the new subscription **shared**
an existing condition or **introduced a new one**. Those two marginal costs will
differ by a large factor, and reporting a blended average of them would hide
precisely the thing being measured.

## Interfaces

Mirrors the metrics idiom already in `packages/pulse-webhooks` (`metrics.ts` +
`PrometheusWebhookMetrics.ts` + `OtelWebhookMetrics.ts`) — one interface, a
no-op default, adapters per backend. One idiom across the project, per note 1.

```ts
export interface CostMeter {
  recordRpcCall(subscriptionIds: readonly string[], method: string, durationMs: number): void;
  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void;
  recordCompute(subscriptionId: string, durationMs: number): void;
  recordStorage(subscriptionId: string, bytes: number): void;
}

export interface CostWindow {
  subscriptionId: string;
  startLedger: number;
  endLedger: number;
  /** Even-split share of actually-incurred cost. Sums to real spend. */
  attributedCost: CostBreakdown;
  /** What this subscription would have cost alone. Never summed. */
  standaloneCost: CostBreakdown;
}
```

### One addition the sketch above did not have

`InMemoryCostMeter` also carries `track(subscriptionId, condition)` and
`untrack(subscriptionId)`, and this is not bookkeeping — it is what makes the
marginal split possible at all.

Whether a new subscription **joined a cohort already being watched** or **opened
a condition nobody was watching** cannot be recovered afterwards from cost
numbers: those two arrivals are the two figures being compared, so the meter has
to be told which one happened at the time it happens. `track()` returns the
arrival it recorded, so a caller can assert on it.

### What ships

| Symbol | What it is |
| --- | --- |
| `CostMeter`, `CostBreakdown`, `CostWindow` | The interface and its shapes |
| `NOOP_COST_METER` | The default — metering is opt-in and costs nothing when off |
| `InMemoryCostMeter` | Attribution, per-window sealing, history, sharing factor, marginal cost |
| `PrometheusCostMeter` | `orbital_backstop_cost_{attributed,standalone}_total`, labels `subscription` / `driver` |
| `OtelCostMeter` | `orbital.backstop.cost.{attributed,standalone}`, same attributes |
| `CompositeCostMeter` | Aggregator plus exporter behind one call site |

`closeWindow(endLedger)` seals the open window and opens the next, so cost
buckets line up exactly with the watcher's coverage windows. A subscription that
is tracked but cost nothing measurable in a window still gets a record — omitting
it would bias every per-subscription mean upwards.

`marginalCost()` returns `null` for a figure it has no clean sample for, rather
than a number. "Measured numbers, not estimates" applies to the code as much as
to the table below: a window that added both kinds of subscription at once is
counted in `transitionsSkippedMixed` and contributes to neither figure.

`subscriptionIds` is a **list** on the shared drivers rather than a single id.
That is the design decision that makes sharing measurable at all: a
single-id signature would force the caller to decide attribution at the call
site, and the split policy would then be scattered across every call site
instead of living in one place.

- `NOOP_COST_METER` — the default, so metering is opt-in and costs nothing when off.
- `PrometheusCostMeter` / `OtelCostMeter` — export through the existing surfaces.

Files: `packages/worker-core/src/backstop/costMeter.ts`,
`packages/worker-core/src/metrics.ts`.

## The measured numbers

<!-- Filled in once 21.1 (#1062) lands and a backstop has run for a week. -->

| | |
| --- | --- |
| Measurement window | *pending* |
| Subscriptions observed | *pending* |
| Distinct conditions watched | *pending* |
| Total attributed cost / window | *pending* |
| Marginal cost, shared condition | *pending* |
| Marginal cost, new condition | *pending* |
| Sharing factor (standalone ÷ attributed) | *pending* |

**This table is the deliverable of #1063 and it cannot be completed yet.** The
acceptance criterion says "the measured numbers, not estimates" — so it stays
empty rather than being filled with numbers that would read as measurements.

### <a id="how-to-fill-it"></a>How to fill it

1. Land 21.1 so a backstop watcher exists.
2. Wire a `CompositeCostMeter(new InMemoryCostMeter(startLedger), new PrometheusCostMeter())`
   into it at the four drivers above, and call `track()` as subscriptions
   activate and `closeWindow()` at each window boundary.
3. Run against testnet for at least one full retention period with a subscription
   count that **changes during the window** — a static count cannot yield a
   marginal cost.
4. Ensure at least one subscription shares a condition and at least one does not,
   or the two marginal figures collapse into one.
5. Read the dashboard query below and paste the results here.

## Dashboard query

Cost against subscription count, which is the chart the pricing decision needs:

```promql
# Attributed cost per window, against the subscription count that produced it
sum(rate(orbital_backstop_cost_attributed_total[1h])) by (driver)
  / on() group_left sum(orbital_backstop_subscriptions_active)

# Marginal cost, split by whether the condition was already being watched
sum(rate(orbital_backstop_cost_attributed_total[1h]))
  / sum(rate(orbital_backstop_subscriptions_active[1h]))
```

## What is blocked, precisely

| Acceptance criterion | Status |
| --- | --- |
| Per-subscription attribution for RPC, scans, compute, storage | **Done** — `InMemoryCostMeter`, four drivers |
| Aggregated per subscription per window, queryable over time | **Done** — `closeWindow`, `history`, `windows`, `totalForWindow` |
| Marginal cost reported explicitly | **Done** — `marginalCost()`, split shared vs new condition |
| Exported through existing Prometheus and OTel surfaces | **Done** — `PrometheusCostMeter`, `OtelCostMeter` |
| Dashboard or documented query | **Done** — above |
| Written cost model with **measured numbers, not estimates** | **Blocked.** Needs 21.1 (#1062) running. Everything to produce them is built. |

Five of six are shipped and tested. The sixth is not a coding task: it needs a
backstop that has actually run, which is 21.1's deliverable. Landing it as
estimates would be worse than landing it empty, because a table of numbers is
read as measurements no matter what the caption says.
