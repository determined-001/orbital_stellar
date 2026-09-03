# Verdict taxonomy for chain-derived worker verification

Design note for issue 19.1 (`21.1`'s and W3's foundation). The issue is labelled
`needs-design` and says so explicitly: *"Get the verdict taxonomy reviewed before
implementing — `needs-design` clears on the taxonomy, not on the code."* This
document is that taxonomy. No engine is implemented here, and
`packages/worker-core` is not scaffolded.

The structural claim (§C.3, §C.6) is that because Orbital already decodes and
normalizes the same events, it can verify **from the chain itself** whether a
worker fired when it should have, rather than trusting the worker's own logs.
The verdict taxonomy is where that claim either holds or quietly stops being
true, because a verdict that cannot be reproduced or defended cannot underwrite
anything in W3.

---

## 1. The model

```
expected condition observed at ledger N
  → expected follow-up invocation by ledger N+k
    → did it occur?
```

A **window** is one instance of that: a condition occurrence, a deadline derived
from the definition's declared latency bound, and whatever invocations landed in
between. Every verdict is about exactly one window. Nothing in this taxonomy
aggregates — reputation scoring (W1) and pricing (W3) are folds over verdicts,
and keeping the fold out of the verdict is what lets both change without
invalidating stored history.

---

## 2. The verdicts

The issue's acceptance names four. Working through the failure modes says there
must be six: two more are needed to stop the four from lying.

| Verdict | Meaning | Counts against the operator? |
| ------- | ------- | ---------------------------- |
| `not-due` | The condition did not oblige a firing in this window | No — nothing was owed |
| `fired` | The invocation landed within the latency bound | No |
| `late` | The invocation landed, after the bound | Yes, with a measured latency |
| `missed` | The bound passed with no invocation | Yes |
| `unverifiable` | The window cannot be reconstructed from chain data | **Excluded, not counted either way** |
| `pending` | The bound has not yet elapsed | Not scoreable yet |

### 2.1 `late` carries a number, not just a flag

W3's pricing tiers depend on *how* late, not merely that something was late, so
`late` is not a boolean variant of `missed`:

```ts
{ verdict: "late", latencyLedgers: 14, deadlineLedger: 90210, firedLedger: 90224 }
```

Measured in **ledgers, not seconds**. Ledger close time varies, and a latency
that drifts with network conditions is not reproducible — the same window would
score differently on a re-run. Wall-clock latency can be derived for display
from `timestamp`, which every `NormalizedEvent` carries; it must not be the
stored measurement.

### 2.2 `unverifiable` is required, and it is not a courtesy

20.7 (off-chain-computation triggers) demands it directly: a condition that is
not on chain cannot be reconstructed from chain data, and scoring it as
`missed` would penalise an operator for the design of their trigger class.

But it is needed even without 20.7, because chain data itself is not always
sufficient — see §4. The rule that makes it safe:

> **`unverifiable` windows are excluded from reputation scores. They are never
> counted as successes.**

Silently treating them as successes turns the score into a number an operator
can inflate by choosing conditions that cannot be checked. Silently treating
them as misses punishes honesty. Excluding them, and **reporting the excluded
count alongside every score**, is the only option that does neither: a worker
whose windows are 90% unverifiable has a score with a visible asterisk rather
than an invisible one.

### 2.3 `pending` exists so verdicts can be immutable

Without it, a window whose deadline has not yet passed has to be either omitted
or provisionally called `missed`. Omitting it makes "no verdict" ambiguous
between *not yet due* and *not evaluated*; provisionally calling it `missed`
means verdicts change after the fact, which breaks §5's reproducibility
guarantee at the first race with the ledger tip.

`pending` is the only verdict that may transition. It becomes `fired`, `late`,
`missed` or `unverifiable` exactly once, when the deadline is behind the
verification horizon (§5.2), and never changes again.

---

## 3. `not-due` is the case to build first

The issue says so, and it is right: *"The `not-due` case is where naive
implementations generate false misses and destroy operator trust in the score.
Test it first."*

A window is `not-due` when the condition was observed but no firing was owed.
Four distinct causes, all of which a naive engine reports as `missed`:

1. **The contract rejected an early call.** The acceptance criterion states it
   directly: *a contract rejection of an early call resolves to `not-due`, never
   `missed`.* The worker did the right thing; the contract said "not yet". This
   is visible in the normalized event — `ContractInvokedEvent` and
   `ContractEmittedEvent` both carry `inSuccessfulContractCall?: boolean`, and a
   rejected invocation is evidence the worker was *awake*, not evidence it was
   asleep. It is arguably stronger evidence of liveness than silence during a
   window where nothing was due.

2. **The precondition was already satisfied.** A payroll disburse whose period
   has already been paid has nothing to do.

3. **The window opened before the definition took effect.** Backfilling
   verification over a ledger range that predates a worker's registration must
   not manufacture a history of misses. Verification is bounded below by the
   definition's activation ledger.

4. **The condition recurred inside an open window.** A condition observed twice
   before the first deadline is one obligation, not two — otherwise a burst of
   source events fabricates a run of misses from a worker behaving correctly.

**Design consequence.** `not-due` must be *derived from the condition*, never
inferred from the absence of an invocation. An engine that reasons "no
invocation, and no obvious reason, therefore `missed`" has the default facing
the wrong way. The default is `not-due`; `missed` requires positively
establishing that a firing was owed.

---

## 4. What the chain does not tell us

The taxonomy has to survive the actual shape of `NormalizedEvent`, and three
properties of it are load-bearing. All three are visible in
`packages/pulse-core/src/index.ts` today.

### 4.1 `ledger` is optional

Both `ContractInvokedEvent` and `ContractEmittedEvent` declare
`ledger?: number` — *"when available"*. Every window boundary, deadline and
latency measurement in this taxonomy is expressed in ledgers, so an event
without one cannot be placed in a window at all.

It must not be substituted with a timestamp-derived estimate. Estimating the
ledger from `timestamp` reintroduces exactly the wall-clock non-determinism
§2.1 removed, and does it invisibly.

> **Rule:** a window whose condition or candidate invocation lacks `ledger` is
> `unverifiable`, with reason `missing-ledger`. Not `missed`.

### 4.2 A decode miss is not a non-firing

`decodedData` is *"undefined on a registry miss, decode error, or when no
registry is configured."* An engine matching conditions on decoded fields sees
exactly the same thing — no match — whether the worker did not fire or the ABI
registry simply lacked a spec.

Those are opposite conclusions about the operator. Conflating them makes a
worker's score depend on Orbital's registry coverage, which the operator does
not control.

> **Rule:** when a condition requires decoded data and decoding did not occur,
> the verdict is `unverifiable`, reason `decode-unavailable`. `EventEngine`
> already emits `event.decode_failed` notifications; the engine consumes them
> rather than inferring from silence.

### 4.3 Reproducibility needs the spec *as of* the ledger

This is the subtle one, and it is the difference between a verdict that can be
disputed and one that can only be argued about.

`AbiRegistryClientLike` exposes an optional `getSpecAt(contractId, ledger)`
alongside `getSpec`, documented as: *"When implemented, `EventEngine` calls it
with the emitting event's `ledger` instead of `getSpec`, so a decode uses the
spec that was current at that ledger rather than the latest one."*

If verification decodes with the *latest* spec, a contract upgrade silently
rewrites history: replaying a range from before the upgrade decodes its events
under a schema that did not exist then, and verdicts change with no ledger
having changed. The replay test would pass today and fail after the next
upgrade, for reasons invisible in the diff.

> **Rule:** verification requires a registry client implementing `getSpecAt`.
> Where it is absent, verdicts over ranges predating a contract's current spec
> are `unverifiable`, reason `spec-not-ledger-versioned` — not silently decoded
> with today's spec.

---

## 5. Reproducibility

*"Reproducibility is the whole product. If a verdict depends on when it was
computed, it cannot underwrite anything in W3 and cannot be disputed by an
operator without a support conversation."*

Three rules make it hold.

### 5.1 A verdict is a pure function of pinned inputs

```
verdict = f(WorkerDefinition@activationLedger, ledgerRange, chainEvents, specs@ledger)
```

Nothing else may enter. In particular: no wall clock, no "latest" anything, no
mutable registry lookup (§4.3), no operator input (§6). If any of these appear
in the call graph, reproducibility is gone regardless of what the tests say.

The replay test in the acceptance criteria is the check: the same range, twice,
must produce byte-identical verdicts. Worth strengthening — a replay over
*overlapping* ranges must agree on the windows they share, which catches
range-boundary state that a single-range replay does not.

### 5.2 Verdicts finalise behind a verification horizon

Verification never evaluates a window whose deadline is within the reorg /
re-delivery horizon of the tip. Below the horizon a window is `pending`; at or
past it, the verdict is computed once and stored immutably.

This is what makes 20.6's "reorg and re-delivery safe" tractable here too: a
duplicated source event arriving late cannot flip a finalised verdict, because
the verdict was not computable while duplication was still possible.

### 5.3 Verdicts carry their own evidence

Every stored verdict records what produced it:

```ts
{
  windowId,                 // deterministic: definitionId + conditionEventId
  verdict,                  // the six above
  conditionLedger,
  deadlineLedger,
  firedLedger?,             // fired | late
  latencyLedgers?,          // late
  reason?,                  // not-due | unverifiable — which of §3 / §4
  evidence: { conditionEventId, invocationTxHash?, specVersion },
  engineVersion,
}
```

`reason` is not decoration. An operator disputing a verdict needs to know
*which* rule fired, and a `missed` with no evidence pointer is an assertion, not
a finding. `engineVersion` is what makes a taxonomy change auditable: verdicts
computed under an older engine stay identifiable rather than being silently
mixed with new ones.

---

## 6. No operator input, and how that is tested

*"Verification never reads operator-supplied logs — a test asserts the engine
compiles with no operator input beyond the definition."*

The `WorkerDefinition` is the only operator-authored input, and it is a
*declaration of intent* (what should happen), not evidence (what did). The
distinction is the whole point of the component: a self-reported log is a claim,
and a marketplace that scores claims is scoring honesty rather than behaviour.

The stated test — the engine's type surface admits nothing else — is necessary
but weak; it constrains the signature, not the call graph. Two stronger checks:

- **A deliberately lying operator changes nothing.** Run the same range with an
  operator-supplied log asserting every window fired. Verdicts must be
  byte-identical to the run without it. This tests the property directly rather
  than a proxy for it.
- **The engine consumes `EventEngine` and nothing else.** The acceptance already
  requires no parallel ingestion path; an architecture test on the imports of
  `packages/worker-core/src/verification/` enforces it as the code grows, which
  a one-time review does not.

---

## 7. All three trigger classes

The acceptance requires the taxonomy to work for all three conditions from §C.1,
even though only time-based has an executor in W0. It does, with different
verdicts reachable:

| Trigger class | Condition source | Reachable verdicts |
| ------------- | ---------------- | ------------------ |
| Time-based (W0) | Ledger arithmetic from the definition | All except `unverifiable` in normal operation |
| Event-based (20.6) | A predicate over `NormalizedEvent` | All six — `unverifiable` via §4.1/§4.2 |
| Off-chain computation (20.7) | An external result | `unverifiable` is the *normal* case absent attestation |

Time-based is the one class whose condition needs no chain evidence at all —
the schedule is in the definition — so `unverifiable` should be vanishingly rare
and worth alerting on when it is not.

Event-based is where §4's three rules earn their keep, since the condition is
itself a normalized event with all of `ledger`, `decodedData` and spec
versioning in play.

Off-chain computation inverts the default: without an attestation the condition
is not on chain and the window is `unverifiable` by construction. 20.7's design
is what moves those windows back into scoreable territory, by putting a signed
attestation on chain with the invocation — which is why that note owes this one
a definition of when an attested condition is reconstructible.

---

## 8. What this note does not decide

- **The scoring fold.** How verdicts become a reputation number is W1's, and
  deliberately downstream. This note only guarantees the fold has a `late`
  latency to weigh and an `unverifiable` count to disclose.
- **The dispute process.** §5.3 makes a verdict defensible; who reviews a
  challenged one is a product decision.
- **Storage.** Verdicts must be immutable and addressable by `windowId`;
  nothing here requires a particular store.
- **The verification horizon's depth.** It is a function of the reorg /
  re-delivery guarantees 18.6 settles.

---

## Review checklist

`needs-design` clears when these are agreed, not when code lands:

1. Six verdicts, not four — is `unverifiable` (§2.2) and `pending` (§2.3) the
   right pair of additions?
2. Is `not-due` correctly the default, with `missed` requiring positive proof of
   obligation (§3)?
3. Are the three `unverifiable` triggers in §4 acceptable, particularly
   requiring `getSpecAt` (§4.3) rather than decoding with the latest spec?
4. Is latency in ledgers, with wall-clock derived for display only (§2.1)?
5. Is the evidence record in §5.3 sufficient for an operator to dispute a
   verdict without a support conversation?
