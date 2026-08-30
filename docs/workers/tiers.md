# Backstop latency tiers

Implements issue 21.3. The definitions live in
[`packages/worker-core/src/backstop/tiers.ts`](../../packages/worker-core/src/backstop/tiers.ts);
this page explains why they are shaped that way.

---

## Why tiers at all

§C.7 requires pricing by latency tier rather than one flat fee, because the two
ends of that range are not the same promise.

For payroll and periodic settlement, a fallback firing an hour late is a
non-event: the money arrives, the window closes, nobody notices. That
guarantee is cheap to make credibly, because keeping it needs little more than
a worker that is usually up and a contract that stays callable.

A trigger whose value decays in ninety seconds is a different product. Keeping
that promise needs redundant operators, monitoring that notices a miss inside
the window rather than after it, and a fee strategy for a congested ledger.
Selling both at one price means either overcharging for the first or lying
about the second.

---

## What W3 ships

**The time-insensitive tier, and nothing else.**

| | Time-insensitive | Latency-sensitive |
|---|---|---|
| Latency bound | 6 hours | 2 minutes |
| Grace period | 1 hour | 30 seconds |
| Price per window | 1 XLM | 50 XLM |
| Max fee multiplier | 10× baseline | 100× baseline |
| **Registrable** | **yes** | **no — 22.4** |

The latency-sensitive tier is *defined* so the abstraction is built to hold it,
and *disabled* so it cannot be sold. Registering it fails with
`TIER_NOT_REGISTRABLE` and a message naming 22.4, which is also the issue that
lands the infrastructure the tier would depend on.

### The flag is a safety device, not a feature toggle

`registrable: false` is not there to stage a rollout. It is there so the
expensive promise cannot be made before the infrastructure exists to keep it.

It is not flipped to demo the tier, to unblock a customer conversation, or to
see what happens. Enabling it is 22.4's job, in the same change that lands the
monitoring the tier is measured against. A tier that is registrable but not
measurable is a promise nobody can tell has been broken.

### One switch, not two

22.4 (#1071) landed its half of `tiers.ts` first, while this issue was still
open: `TierEnableDecision`, a documented and reversible decision record that
`assertTierEnableDecisionIsValid` refuses to accept as `enabled` without a
prior `CostMeasurement` from 21.2.

That could easily have become a second, independent switch sitting next to
`registrable` — and two switches for one safety property is how a tier ends up
sold while the decision record still says disabled. So the tier table does not
carry its own boolean for the expensive tier: `TIERS["latency-sensitive"].registrable`
**is** `LATENCY_SENSITIVE_TIER_DEFAULT.enabled`, revalidated on the way through.

Enabling the tier is therefore one edit, to the decision record, and it drags
the measurement requirement along with it. The cheap tier needs no such record:
§C.7's point is that its guarantee is cheap to make credibly, so there is
nothing to measure before promising it.

---

## Machine-readable boundaries

`GuaranteeBounds` is numbers and booleans, not prose, because
[21.4's SLO monitoring](../slo.md) has to assert against **the same values a
subscriber was sold** — and it cannot assert against a sentence on a pricing
page.

```ts
{
  latencyBoundMs: 6 * HOUR,
  gracePeriodMs:  1 * HOUR,
  guaranteedWhen: {
    subscriptionActive:    true,
    triggerPermissionless: true,
    fundsInPlace:          true,
    maxFeeMultiplier:      10,
  },
}
```

`withinGuarantee(tier, dueAt, firedAt)` and `guaranteeDeadline(tier, dueAt)`
are exported from the same module so the monitoring and the billing read one
source rather than two that drift.

### The exclusions are part of the guarantee

A backstop that fires only when it happens to be able to is not a guarantee, so
the conditions are stated as data rather than argued after an incident:

- **`subscriptionActive`** — a paused subscription is not backstopped.
- **`triggerPermissionless`** — the backstop holds no authority and cannot fire
  a trigger that needs a signer. This is the worker layer's second rule
  ([`docs/design/workers.md`](../design/workers.md)) reappearing as a
  precondition: there is no tier that buys custody.
- **`fundsInPlace`** — the backstop pays gas, never the payment itself.
- **`maxFeeMultiplier`** — congestion above this multiple of baseline suspends
  the guarantee. Promising to outbid an arbitrary fee market is promising
  something nobody can deliver, so the ceiling is written down.

---

## Tier changes are versioned

The tier is attached to the subscription, and a tier change is a **new
subscription version** rather than an edit.

The reason is the SLO dispute that happens later: what was promised over
windows 10–40 has to stay answerable once the tier moves. Every audit entry
carries the `version` and `tier` in force when it was written, so the terms at
any past window replay from the record alone.

Lifecycle transitions — pause, resume, cancel — do **not** bump the version.
They change whether the guarantee applies, not what it was.

---

## Related

- [`docs/design/workers.md`](../design/workers.md) — the four rules, and why no
  tier buys authority
- [`packages/worker-core/src/backstop/tiers.ts`](../../packages/worker-core/src/backstop/tiers.ts)
  — the tier table and 22.4's enable decision, in one module for the reason above
- [`packages/worker-core/src/subscription/`](../../packages/worker-core/src/subscription/)
