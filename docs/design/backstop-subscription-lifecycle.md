# Backstop subscription lifecycle and billing hooks

**Status: implemented.** `packages/worker-core` landed with 18.3
([#1038](https://github.com/determined-001/orbital_stellar/issues/1038)), which
was the blocker: this design was written while the package had no tracked files.
The lifecycle, the coverage ledger and the billing hooks now ship in
`packages/worker-core/src/subscription/`.

21.5 ([#1066](https://github.com/determined-001/orbital_stellar/issues/1066)) has
merged. 21.3 ([#1064](https://github.com/determined-001/orbital_stellar/issues/1064))
is still open, which is why `tier` is typed `string` rather than a union — see
[What is still open](#what-is-still-open).

## The shape of the problem

Turning a backstop tier into a paid subscription: activation, renewal, lapse,
cancellation, and the hooks a billing system attaches to.

Per [`open-source-policy.md`](../open-source-policy.md), open data and SDKs are
MIT and the operated service is the product. Billing glue is the operated side.
So the **interface** lives in `worker-core` and the **implementation** does not
live in this repository at all.

## Lifecycle

```
                  activate()                    renew()
   (none) ─────────────────────────▶ active ◀──────────────┐
                                       │                   │
                    beginExpiring()    │                   │
                     (grace window)    ▼                   │
                                    expiring ──────────────┘
                                       │
                                    lapse()
                                       ▼
                                    lapsed ─ reactivate() ─▶ active
                                       │
                                       ▼
   active ── cancel() ──▶ cancelled ───┴──── reactivate() ─▶ active
```

| State | Backstopped? | Legal transitions |
| --- | --- | --- |
| `"active"` | yes | `"expiring"`, `"cancelled"` |
| `"expiring"` | **yes** — grace is covered | `"active"` (renewed), `"lapsed"` |
| `"lapsed"` | no | `"active"` (reactivated) |
| `"cancelled"` | no | `"active"` (reactivated) |

The states are the string literals above, exported as `SubscriptionState`, and
the table itself is exported as `LEGAL_TRANSITIONS` — the diagram and the code
cannot drift because the code *is* the table.

Transitions are enforced, not advisory: a transition outside this table is a
programming error and throws rather than being coerced. Every transition is
written to the coverage ledger below before it takes effect, so the record is
never behind the state.

### Notify before the lapse, never after

Implementation note 1, and the one rule that shapes the state machine. Silent
lapse followed by a missed intervention is the worst possible sequence for a
product whose entire value proposition is *someone is watching*. The subscriber
must learn coverage is ending while they can still do something about it.

Hence `"expiring"` exists as a distinct state rather than a flag: it is
**covered**, it is entered on a schedule ahead of expiry, and entering it fires
`onExpiring`. A subscription can only reach `"lapsed"` *through* `"expiring"`, so
there is no code path in which a lapse happens without a prior notification.

Two further rules give the notice teeth, both enforced at runtime:

- `beginExpiring(atLedger, lapsesAtLedger)` refuses a notice shorter than one
  full window. A warning the subscriber cannot act on within a window is not a
  warning.
- `lapse(atLedger)` refuses to lapse earlier than the ledger the subscriber was
  told about. A lapse ahead of the announced ledger would make the notice a lie.

The acceptance criterion "a lapsed subscription stops being backstopped within
one window" falls out of this: the watcher reads coverage state at the top of
each window, and `"lapsed"` is not covered.

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

export type SubscriptionEvent = {
  subscriptionId: string;
  tier: string;
  atLedger: number;
  /** The window this transition closed. `null` only on a first activation,
   *  where coverage starts and nothing was closed. */
  window: CoverageWindow | null;
};

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
| `BillingHooks`, `SubscriptionState`, `CoverageWindow`, `CoverageLedger` in `worker-core` | The billing implementation — payment processor, invoicing, dunning |

No vendor SDK is committed to this repository.

## Auditable coverage windows

Implementation note 2: an auditable record is what makes a disputed intervention
resolvable without a support conversation. For **any** window it must be
answerable from stored records whether it was covered — including retroactively,
including for a subscription that has since lapsed.

```ts
export type CoverageWindow = {
  subscriptionId: string;
  startLedger: number;
  endLedger: number;
  covered: boolean;
  /** Why, in the record itself - "active", "grace", "lapsed", "cancelled". */
  reason: CoverageReason;
};

export interface CoverageLedger {
  append(window: CoverageWindow): Promise<void>;
  findAt(subscriptionId: string, ledger: number): Promise<CoverageWindow | null>;
  history(subscriptionId: string): Promise<CoverageWindow[]>;
}
```

Append-only. A record is never updated or deleted, so "was I covered at ledger
N" is a lookup, not a reconstruction from an event log whose replay could differ
from what actually happened at the time. `reason` is stored rather than derived
because the policy that produced it may change later, and the answer must not.

Windows are half-open ledger intervals `[startLedger, endLedger)`, so a ledger
belongs to exactly one record. `InMemoryCoverageLedger` refuses an overlapping
append and refuses a record whose `covered` flag contradicts its own `reason` —
the store will not hold a record that lies, whatever writes to it.

### Sealing, and why a transition is not enough

A transition writes the stretch it just closed. That covers every window
containing a transition and no others, which is not what "for **any** window"
asks for.

So the lifecycle also exposes `sealTo(atLedger)`: close the open stretch at a
ledger and reopen from there, without changing state and without firing a hook.
The backstop watcher (21.1, #1062) seals at each window boundary it processes,
which is what makes the record complete up to the ledger the watcher has reached.

### The three answers, and why there are three

`coverageForWindow()` returns `covered`, `uncovered`, `partial` or `unknown`,
and `wasCovered()` returns `true`, `false` or `null`.

`unknown`/`null` are deliberately not `false`. "We have no record for that
stretch" and "we recorded that you were not covered" are different answers in a
dispute, and collapsing them would let a gap in the record read as a denial of
coverage. A gap is an operational failure to seal, not a fact about the
subscriber.

## Files

- `packages/worker-core/src/subscription/lifecycle.ts` — states, transition
  table, `BackstopSubscription`
- `packages/worker-core/src/subscription/billing.ts` — `BillingHooks`,
  `NOOP_BILLING_HOOKS`, `RecordingBillingHooks`
- `packages/worker-core/src/subscription/coverage.ts` — the append-only record
  and the audit reads
- `packages/worker-core/test/subscription/**` — the behaviour above, asserted
- `packages/worker-core/test/types.exhaustive.test-d.ts` — the compile-time
  credential guard
- `docs/open-source-policy.md` — the boundary-table row and the
  "Backstop subscriptions" section

## <a id="what-is-still-open"></a>What is still open

- **Tier identifiers** come from latency-tier configuration (21.3, #1064), which
  is still open, so `tier` is typed as `string` rather than a union that would
  have to be rewritten. Nothing else here depends on it.
- **The watcher half of the loop.** "Stops being backstopped within one window"
  is asserted here against the coverage record — after a lapse at ledger *N*,
  the window `[N, N + windowLedgers)` reads back `uncovered`. What is not
  asserted here is that a *running* backstop stops intervening, because the
  backstop watcher (21.1, #1062) is still open. `coverageForWindow()` is the
  seam it reads; when it lands, that end-to-end assertion belongs with it.
- **Durable adapters.** Only `InMemoryCoverageLedger` ships. A Postgres adapter
  implements the same three methods and must enforce the same invariants —
  `assertValidCoverageWindow` is exported so it does not re-derive them.
