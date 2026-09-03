# Worker price and slippage guard rails

Trade automation reads prices, and a price source is an attack surface. This
document is the on-chain/off-chain split for the guards that sit in front of
the vault's slippage bound - its last line of defence - for issue 22.5
(`packages/worker-core/src/guards/priceGuard.ts`,
`packages/worker-core/src/guards/circuitBreaker.ts`).

**Status: partial.** The off-chain guards below are implemented and tested.
The on-chain half is a specification, not code: issue 22.5 depends on 22.3
("Copy-trade worker on the vault pattern"), and `contracts/vault` does not
exist in this repo yet. Rather than invent a vault contract as a side effect
of this issue, this document states what that contract **must** enforce once
it exists, so 22.3's implementation has a concrete target.

---

## The rule (implementation note 1)

> Anything enforceable in the contract belongs in the contract. Off-chain
> guards protect against a compromised worker only if the worker is honest,
> which is the wrong assumption.

A guard that only runs off-chain is a guard a compromised or buggy worker
process can simply skip. Every guard below is placed on-chain unless there is
a concrete reason the contract cannot enforce it - not because off-chain is
easier to ship first.

## The split

| Guard | Where | Why |
|---|---|---|
| Slippage bound (min received / max price impact) | **On-chain** (existing, unchanged by this issue - the vault's own last line of defence) | The contract observes the actual execution price atomically with the trade; nothing off-chain can substitute for that. |
| Staleness bound | **On-chain**, once the vault reads its own oracle | A price passed to (or read by) the vault contract carries a timestamp the contract can compare against `ledger().timestamp()` directly - no off-chain trust required. If the vault's design has the *worker* supply the price (rather than the contract fetching it itself), the contract must still reject a stale timestamp; it cannot rely on the worker to have checked. |
| Deviation check (two independent sources) | **On-chain where the vault contract can call a second oracle itself; off-chain as a pre-filter regardless** | If 22.3's vault design queries a second oracle contract directly (e.g. a second Reflector feed, or a DEX-derived price) as part of trade execution, the divergence check belongs there, for the same reason as staleness. Until that composability is confirmed feasible within Soroban's cross-contract call and CPU budget, the off-chain check in `priceGuard.ts` is not a substitute for it - it is a pre-filter that stops an obviously bad trade from ever reaching the contract, reducing wasted transaction fees and giving a faster feedback loop than waiting for the chain to reject it. |
| Circuit breaker (N consecutive trips → manual re-enable) | **Off-chain, inherently** | "Consecutive trips" is worker-process state, and "manual re-enable" means a human operator decision. There is no meaningful on-chain analogue unless 22.3 chooses to add an explicit pause flag the vault contract checks before executing - which is a legitimate defense-in-depth addition for 22.3 to consider, but the trip-counting and human-review workflow itself stays off-chain. |
| Guard-trip recording / scorecard | **Off-chain** | Operational visibility, not a security boundary - see `packages/worker-core/src/guards/circuitBreaker.ts`'s `GuardTripRecord`. |

The short version: **on-chain where the contract has the information to check
it itself; off-chain as a pre-filter everywhere, and as the only enforcement
where the check is inherently process-local** (the circuit breaker).

## Off-chain guards (implemented)

### Staleness (`checkStaleness`)

Rejects a `PriceReading` older than a configured `maxAgeSeconds`, and rejects
a reading timestamped in the future (clock skew, or a source lying about
freshness) rather than treating it as "fresher than fresh."

### Deviation (`checkDeviation`)

Compares two independently-sourced `PriceReading`s and rejects the pair if
they diverge past a configured `maxDivergenceBps`. Divergence is computed
against the smaller normalized price, so the check is symmetric regardless of
argument order. A non-positive price on either side is treated as maximally
diverging rather than causing a division by a non-positive number.

Per §C.8: consider [Reflector](https://reflector.network) as one price
source, but the check exists specifically to avoid depending on it (or any
single source) alone - `checkDeviation` requires two readings from
independent sources by construction; there is no single-reading code path.

### `checkPriceGuard`

Runs staleness on both readings first (a stale reading is meaningless
regardless of how well it happens to agree with a second source), then
deviation. A worker calls this once per trade decision, with the primary and
secondary readings it has already fetched; a failing verdict means the
action is skipped for this cycle, not retried with different sources.

### Circuit breaker (`CircuitBreaker`)

Tracks *consecutive* guard trips per worker. Reaching `maxConsecutiveTrips`
opens the breaker; a clean guard check (`recordSuccess`) resets the counter
while closed, so intermittent trips do not accumulate toward tripping it.
Once open, the breaker stays open - further trips are still recorded for the
scorecard, but only `manualReenable(reenabledBy, reenabledAtUnix, rationale)`
closes it again. This is deliberate friction (implementation note 2): an
automatic reset would re-enter the exact condition that tripped the breaker
in the first place.

Every trip is recorded (`getTrips()`) and handed to an optional `onTrip`
callback - the seam a real deployment uses to publish to a scorecard and page
an operator. Every re-enable is recorded too (`getReenables()`), so "who
turned this back on, and why" is always answerable later.

## What's still open

- The actual vault contract (22.3) does not exist, so the on-chain rows above
  are a specification the vault must satisfy, not verified behavior.
- `PriceReading.source` is a free-form string in this stub; once a real
  oracle integration exists, it should probably be a closed set (or at least
  documented conventions, e.g. `"reflector:<feed>"`).
- Whether the deviation check is *also* enforceable on-chain depends on
  Soroban cross-contract call costs the vault design has not measured yet -
  see the table above.
