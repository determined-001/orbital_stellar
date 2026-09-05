# Soroban vault with hard constraints

**Status: partially implemented — the review is still open.** Everything below
except `act()` is built and tested in `contracts/vault` (23 tests, all custody
guarantees negatively asserted). `act()` is deliberately absent because open
question 3 is unresolved and it changes that function's shape. See
[Implementation status](#implementation-status).

Issue
[#1068](https://github.com/determined-001/orbital_stellar/issues/1068) carries
`needs-design`, and its own acceptance criteria require sign-off before
implementation. This document is the thing to sign off on. Nothing in
`contracts/vault/` is written yet, deliberately.

## Why this contract decides whether W4 exists

[§C.2 rule 3](./workers.md#c2-no-user-custody) in code. For copy-trading or
signal-driven actions, the subscriber deposits into a vault the worker can act
*on* but never *own*. The worker's power is "call a constrained function"; it is
never "decide where money goes".

If this contract is weak, W4 is a custody product wearing a different name — and
should be evaluated, and regulated, as one. So the guarantees are the product,
and the happy path is the easy part.

## Attack surface, enumerated first

Per implementation note 1, the negative tests come before the happy path. Every
row below is a test that must exist and must assert a revert.

| # | If a worker (or anyone) tries to… | What stops it |
| --- | --- | --- |
| 1 | withdraw to an address of its choosing | `withdraw()` takes **no recipient parameter** — the depositor is read from storage |
| 2 | withdraw at all | `withdraw()` requires `depositor.require_auth()` |
| 3 | add a pool or asset to the allow-list | config setters require `depositor.require_auth()` |
| 4 | act on a pool outside the allow-list | `act()` checks membership before dispatch |
| 5 | act on an asset outside the allow-list | same check, on the asset |
| 6 | exceed the slippage bound | `min_out` is derived from the stored bound and the quoted amount, and the action reverts below it |
| 7 | replace itself with another worker | `set_worker()` requires `depositor.require_auth()` |
| 8 | keep acting after revocation | `act()` reads the current worker each call; revocation clears it |
| 9 | act after the depositor revoked mid-flight | revocation is a state write, so any later call fails regardless of when it was signed |
| 10 | drain via repeated sub-limit actions | per-window action cap, set by the depositor |
| 11 | call `act()` with a `to` that is not the vault | the vault is always the recipient of an action's output; no destination parameter exists |
| 12 | initialise a vault someone else owns | `__constructor` binds the depositor once; re-initialisation reverts |
| 13 | upgrade the contract to a permissive version | no upgrade entrypoint in v1 (see [Upgradability](#upgradability)) |

## Interface

```rust
#[contracterror]
#[repr(u32)]
pub enum Error {
    NotInitialized      = 1,
    AlreadyInitialized  = 2,
    NotDepositor        = 3,
    NotWorker           = 4,
    WorkerRevoked       = 5,
    PoolNotAllowed      = 6,
    AssetNotAllowed     = 7,
    SlippageExceeded    = 8,
    ActionLimitReached  = 9,
    InsufficientBalance = 10,
    ZeroAmount          = 11,
}

#[contracttype]
pub struct VaultConfig {
    /// Set once at construction. Never mutable, by any path.
    pub depositor: Address,
    /// Allow-listed liquidity pools. Only the depositor may change this.
    pub pools: Vec<Address>,
    /// Allow-listed assets. Only the depositor may change this.
    pub assets: Vec<Address>,
    /// Max tolerated slippage in basis points, enforced on chain.
    pub max_slippage_bps: u32,
    /// Max actions the worker may take per window. A drain via many small
    /// legal actions is still a drain.
    pub max_actions_per_window: u32,
    pub window_ledgers: u32,
}
```

| Function | Auth | Notes |
| --- | --- | --- |
| `__constructor(depositor, config)` | — | Binds the depositor permanently. Reverts if already initialised. |
| `deposit(asset, amount)` | `depositor` | Asset must be allow-listed. |
| `withdraw(asset, amount)` | `depositor` | **No recipient parameter exists.** Pays `config.depositor`, read from storage. |
| `act(pool, asset_in, amount_in, min_out)` | `worker` | The single constrained action. |
| `set_worker(worker)` | `depositor` | Grants permission. |
| `revoke_worker()` | `depositor` | Unilateral, immediate. |
| `set_allowlist(pools, assets)` | `depositor` | Replaces wholesale; the worker has no path to it. |
| `set_bounds(max_slippage_bps, max_actions_per_window, window_ledgers)` | `depositor` | |
| `config()` / `worker()` / `balance(asset)` | — | Read-only. |

### `withdraw()` has no recipient parameter — the point of the whole design

Not "validated". **Absent.** A parameter that must be checked is a check someone
can later relax, in a refactor, under deadline, with a plausible-sounding reason.
A parameter that does not exist cannot be relaxed, and a reviewer can confirm the
guarantee from the function signature alone without reading the body.

The same reasoning removes any destination from `act()`: an action's output
lands in the vault, always. The worker chooses *whether* and *within what
bounds*, never *where*.

### Revocation is a storage read on every call

`act()` loads the current worker every time rather than trusting anything cached
or pre-authorised. So `revoke_worker()` takes effect at the next call with no
settlement delay, no window to drain, and no cooperation needed from the worker
— including during an incident, which is exactly when it matters.

## Slippage

`max_slippage_bps` is enforced **on chain**, not by the worker computing a
`min_out` we trust. The vault derives the floor itself from the pool quote and
the stored bound, and takes `min(caller_min_out, derived_floor)` so a worker can
be *stricter* than the depositor's bound but never looser. A violating action
reverts; it does not clamp, because silently executing something other than what
was asked is its own failure.

## What this deliberately does not do

- **No upgrade entrypoint in v1.** <a id="upgradability"></a>An upgradable vault
  is a vault whose guarantees are whatever the upgrade authority says tomorrow.
  Migration is opt-in: the depositor withdraws and deposits into a new vault, an
  action only they can take.
- **No emergency pause.** A pause the operator controls is an operator who can
  freeze user funds. The depositor's `withdraw()` is always available.
- **No fee skim inside the vault.** Fees are billed by the subscription layer
  (#1067), outside the money path, so a billing bug can never move deposits.
- **No batching of multiple pools in one `act()`.** One action, one pool, one
  bounded outcome — a batch is a place for a bad leg to hide behind a good one.

## Test plan

`contracts/vault/src/test.rs`, negative tests first. Each of the 13 rows above
gets a test asserting the specific `Error`, not merely "it panicked" — asserting
the discriminant is what stops a future refactor from reverting for a different
reason and still passing.

Happy path after that: deposit → act within bounds → withdraw full balance to
the depositor; and re-deposit after revocation, proving revocation does not strand
funds.

## Files

- `contracts/vault/src/lib.rs`
- `contracts/vault/src/test.rs`
- `contracts/Cargo.toml` — add `vault` to `members`
- `docs/design/vault-pattern.md` (this file)

Follows `contracts/registry`: `#![no_std]`, `crate-type = ["cdylib", "rlib"]`,
`soroban-sdk` from `[workspace.dependencies]` (27.0.0), `testutils` as a
dev-dependency, and the `wasm32v1-none` target pinned in `rust-toolchain.toml`.

## Open questions for the review

1. **Window accounting for `max_actions_per_window`** — ledger-based windows are
   cheap and need no oracle, but drift against wall-clock. Acceptable?
2. **Multiple workers per vault**, or exactly one? One is simpler to reason about
   and to revoke; several would need per-worker bounds.
3. **`act()`'s pool interface** — bind to a specific AMM interface, or take an
   opaque function selector constrained by the allow-list? The former is safer
   and narrower; the latter survives a new AMM without a redeploy. This is the
   biggest open call and it changes the shape of rows 4, 5 and 11.
4. **Should `deposit()` be callable by anyone** (a third party topping up a
   depositor's vault), or the depositor only? Restricting it is simpler;
   allowing it enables funding flows we may want later.

---

## Implementation status

<a id="implementation-status"></a>

Added when `contracts/vault` landed. This section records what is real, so the
design doc cannot drift into describing a contract that does not match it.

| Interface row | State |
| --- | --- |
| `__constructor(depositor, config)` | built; rejects re-init, a zero-ledger window, and slippage above 100% |
| `deposit(asset, amount)` | built; depositor-only, allow-list enforced |
| `withdraw(asset, amount)` | built; **no recipient parameter**, asserted from the authorized call's argument list |
| `act(pool, asset_in, amount_in, min_out)` | **not built** — blocked on open question 3 |
| `set_worker` / `revoke_worker` | built; revocation is immediate |
| `set_allowlist` / `set_bounds` | built; depositor-only, no worker path |
| `config()` / `worker()` / `balance(asset)` | built, plus `action_window()` |

### Decisions taken by the implementation

These were the cheap calls; they are recorded here rather than left implicit,
and the review can still overturn any of them.

- **Q1, window accounting** — ledger-based, as proposed. No oracle, not
  manipulable by a timestamp, drifts against wall-clock as close times vary.
  `window_ledgers == 0` is rejected rather than treated as "unlimited".
- **Q2, workers per vault** — exactly one. Simpler to reason about and to
  revoke; `set_worker` replaces rather than appends.
- **Q4, who may deposit** — depositor only. Widening this later is
  backward-compatible; narrowing it after someone depends on third-party
  top-ups is not.

### Still open

- **Q3, `act()`'s pool interface** — bind to a specific AMM, or take an opaque
  selector constrained by the allow-list? This is the one that must be settled
  before `act()` can be written, and it changes the storage and tests around it.

### One decision the implementation added

`withdraw()` deliberately does **not** check the allow-list. An asset
allow-listed at deposit time and removed afterwards must still be retrievable;
gating withdrawal on the allow-list would let a depositor strand their own
funds by narrowing their own configuration, turning a safety control into a
trap. Covered by
`withdraw_still_works_after_the_asset_is_removed_from_the_allowlist`.
