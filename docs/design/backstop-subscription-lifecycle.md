# Backstop subscription lifecycle and billing hooks

**Status: proposed, and blocked.** Issue
[#1067](https://github.com/determined-001/orbital_stellar/issues/1067) depends on
21.3 ([#1064](https://github.com/determined-001/orbital_stellar/issues/1064)) and
21.5 ([#1066](https://github.com/determined-001/orbital_stellar/issues/1066)),
both open, and `packages/worker-core` does not exist in this repository yet —
it has no tracked files. This document specifies the seam so it can be reviewed
now and implemented as soon as the package lands.

## The shape of the problem

Turning a backstop tier into a paid subscription: activation, renewal, lapse,
cancellation, and the hooks a billing system attaches to.

Per [`open-source-policy.md`](../open-source-policy.md), open data and SDKs are
MIT and the operated service is the product. Billing glue is the operated side.
So the **interface** lives in `worker-core` and the **implementation** does not
live in this repository at all.

## Lifecycle

```
                  activate()                  renew()
   (none) ───────────────────────▶ Active ◀───────────────┐
                                     │                    │
                          expiring   │                    │
                     (grace window)  ▼                    │
                                  Expiring ───────────────┘
                                     │
                            grace elapsed
                                     ▼
                                   Lapsed ──── activate() ──▶ Active
                                     │
                                     ▼
   Active ── cancel() ──▶ Cancelled ─┴──────── activate() ──▶ Active
```

| State | Backstopped? | Legal transitions |
| --- | --- | --- |
| `Active` | yes | `Expiring`, `Cancelled` |
| `Expiring` | **yes** — grace is covered | `Active` (renewed), `Lapsed` |
| `Lapsed` | no | `Active` (reactivated) |
| `Cancelled` | no | `Active` (reactivated) |

Transitions are enforced, not advisory: a transition outside this table is a
programming error and throws rather than being coerced. Every transition is
written to the coverage ledger below before it takes effect, so the record is
never behind the state.

### Notify before the lapse, never after

Implementation note 1, and the one rule that shapes the state machine. Silent
lapse followed by a missed intervention is the worst possible sequence for a
product whose entire value proposition is *someone is watching*. The subscriber
must learn coverage is ending while they can still do something about it.

Hence `Expiring` exists as a distinct state rather than a flag: it is
**covered**, it is entered on a schedule ahead of expiry, and entering it fires
`onExpiring`. A subscription can only reach `Lapsed` *through* `Expiring`, so
there is no code path in which a lapse happens without a prior notification.

The acceptance criterion "a lapsed subscription stops being backstopped within
one window" falls out of this: the watcher reads coverage state at the top of
each window, and `Lapsed` is not covered.

## Billing hooks

```ts
/** Facts the operated billing system reacts to. Nothing here returns money,
 *  a card token, or an invoice - only signals. */
export interface BillingHooks {
  onActivated(e: SubscriptionEvent): Promise<void>;
  onRenewed(e: SubscriptionEvent): Promise<void>;
  onExpiring(e: SubscriptionEvent & { lapsesAtLedger: number }): Promise<void>;
  onLapsed(e: SubscriptionEvent): Promise<void>;
  onCancelled(e: SubscriptionEvent): Promise<void>;
}

export interface SubscriptionEvent {
  subscriptionId: string;
  tier: string;
  atLedger: number;
  window: CoverageWindow;
}

/** The default. An open-source user gets a working, unbilled backstop. */
export const NOOP_BILLING_HOOKS: BillingHooks;
```

This mirrors the metrics idiom already in `packages/pulse-webhooks`
(`metrics.ts` + `PrometheusWebhookMetrics.ts` + `OtelWebhookMetrics.ts`): one
interface, a no-op default, adapters elsewhere. One idiom across the project.

### No payment credentials pass through `worker-core`

Structural, not a convention. The hook signatures carry no card token, no
customer secret, no API key — only a subscription id, a tier and a window. The
operated adapter resolves its own customer mapping on its own side.

Two things enforce it:

1. There is nowhere in the types to put a credential.
2. The custody gate (#1073) covers `packages/worker-core/**` and fails on a
   field pairing a user-ish owner with key material, so a later PR that adds one
   to a subscription record trips CI.

### The open/closed split

`docs/open-source-policy.md` gains a row in the boundary table, matching the one
already drawn for the hosted registry:

| Public interface (MIT) | Private adapter (Closed) |
| --- | --- |
| `BillingHooks`, `SubscriptionState`, `CoverageWindow` in `worker-core` | The billing implementation — payment processor, invoicing, dunning |

No vendor SDK is committed to this repository.

## Auditable coverage windows

Implementation note 2: an auditable record is what makes a disputed intervention
resolvable without a support conversation. For **any** window it must be
answerable from stored records whether it was covered — including retroactively,
including for a subscription that has since lapsed.

```ts
export interface CoverageWindow {
  subscriptionId: string;
  startLedger: number;
  endLedger: number;
  covered: boolean;
  /** Why, in the record itself - "active", "grace", "lapsed", "cancelled". */
  reason: CoverageReason;
}
```

Append-only. A record is never updated or deleted, so "was I covered at ledger
N" is a lookup, not a reconstruction from an event log whose replay could differ
from what actually happened at the time. `reason` is stored rather than derived
because the policy that produced it may change later, and the answer must not.

## Files, when unblocked

- `packages/worker-core/src/subscription/lifecycle.ts`
- `packages/worker-core/src/subscription/billing.ts`
- `packages/worker-core/src/subscription/coverage.ts`
- `docs/open-source-policy.md` — the boundary-table row above

## What is blocked, precisely

- The **state machine, hooks and coverage ledger** are self-contained and
  implementable the moment `packages/worker-core` exists.
- **"Stops being backstopped within one window"** cannot be demonstrated until
  the backstop watcher (21.1, #1062) exists to read coverage state. The seam is
  defined here; the assertion needs the other half.
- **Tier identifiers** come from latency-tier configuration (21.3, #1064), so
  `tier` is typed as `string` here rather than a union that would have to be
  rewritten.
