# Backstop readiness cost model

**Status: proposed, and blocked on measurement.** Issue
[#1063](https://github.com/determined-001/orbital_stellar/issues/1063) depends on
21.1 ([#1062](https://github.com/determined-001/orbital_stellar/issues/1062)),
which is open, and `packages/worker-core` does not exist in this repository yet
— it has no tracked files.

This document is the **model and the measurement plan**. The numbers are
deliberately absent: §C.7's whole point is that readiness cost must be measured
rather than assumed, and there is no backstop running to measure. Filling this
table with plausible estimates would defeat the criterion it is meant to satisfy.

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
  recordRpcCall(subscriptionIds: string[], method: string, durationMs: number): void;
  recordExportScan(subscriptionIds: string[], bytesScanned: number): void;
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

### How to fill it

1. Land 21.1 so a backstop watcher exists.
2. Wire `CostMeter` into it at the four drivers above.
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
| Per-subscription attribution for RPC, scans, compute, storage | Designed; needs `worker-core` |
| Aggregated per subscription per window, queryable over time | Designed; needs `worker-core` |
| Marginal cost reported explicitly | Designed; needs `worker-core` |
| Exported through existing Prometheus and OTel surfaces | Designed; idiom already exists in `pulse-webhooks` |
| Dashboard or documented query | **Done** — above |
| Written cost model with **measured numbers, not estimates** | **Blocked.** Needs 21.1 running. |
