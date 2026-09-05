//! Property-test specifications for the vault contract (issue #1069, "22.2
//! Vault security audit and property tests").
//!
//! **These tests do not run yet.** The vault contract now exists (#1068), and
//! three of the four invariants below are covered by example-based tests in
//! `src/test.rs` - `withdraw_pays_the_depositor`,
//! `withdraw_authorizes_only_asset_and_amount_with_no_destination`,
//! `a_worker_cannot_widen_the_allowlist`, `a_worker_cannot_withdraw` and
//! their neighbours. What is still missing here is the *property* form:
//! quantifying over every reachable state rather than the handful a unit test
//! constructs, which is what the acceptance criteria ask for and what a
//! hand-written example can never provide.
//!
//! Every function below stays `#[ignore]`d with a `todo!()` body, so
//! `cargo test` reports them as ignored rather than passing and this file
//! cannot create a false impression that the vault has been property-tested.
//! Filling them in needs a property-testing dependency and generators, which
//! is issue #1069's own scope.
//!
//! Implementation note 1: "State the invariants as properties first, then
//! fuzz against them - a fuzzer with no invariant is a slow random test."
//! These are that first step. `tests/fuzz.rs` is the second step, and also
//! not runnable yet, for the same reason.
//!
//! This file does not depend on `proptest` or any other property-testing
//! crate. Adding one now, with nothing to test, would be dead weight in the
//! dependency tree; 22.1's implementation (or a follow-up to this issue) is
//! where the real dependency and generators belong.

/// Invariant: funds only ever return to their depositor.
///
/// No sequence of vault operations - deposit, withdraw, worker-triggered
/// action, or any combination - may result in a withdrawal (or an
/// equivalent balance movement) crediting an account other than the
/// address that deposited those funds. This is the property that makes
/// "the worker holds no subscriber assets at any point" (see
/// `packages/worker-core/src/vault/types.ts`, issue #1070) actually true at
/// the contract level rather than just true of the worker's code.
#[test]
#[ignore = "needs a property-testing harness (#1069); examples in src/test.rs cover this"]
fn funds_only_ever_return_to_their_depositor() {
    todo!("requires the vault contract from #1068 (22.1)")
}

/// Invariant: the allow-list only narrows.
///
/// Once an asset or pool is removed from a vault's allow-list, no operation
/// may re-add it without an explicit, separately-authorized action from the
/// subscriber. A worker, or any automated process, must never be able to
/// widen its own permitted trading surface.
#[test]
#[ignore = "needs a property-testing harness (#1069); examples in src/test.rs cover this"]
fn allow_list_only_narrows() {
    todo!("requires the vault contract from #1068 (22.1)")
}

/// Invariant: slippage bounds always hold.
///
/// Every executed trade's realized price is within the vault's configured
/// `slippageBoundBps` of the price quoted at submission time, for every
/// reachable contract state - not just the states a unit test happens to
/// construct. A violation must revert the transaction, never partially
/// apply. See `docs/design/worker-guard-rails.md` (issue #1072) for how
/// this bound relates to the off-chain price guards that sit in front of
/// it.
#[test]
#[ignore = "needs act() - blocked on open question 3 in docs/design/vault-pattern.md"]
fn slippage_bounds_always_hold() {
    todo!("requires the vault contract from #1068 (22.1)")
}

/// Invariant: worker authority never widens.
///
/// A worker's authorized action set (which functions it may call, with
/// what bounds) can only be reduced or left unchanged by any sequence of
/// operations - never expanded except by an explicit, separately-authorized
/// subscriber action. This is the contract-level enforcement of "the
/// worker's authority never exceeds 'call a constrained function'" (issue
/// #1070, §C.1).
#[test]
#[ignore = "needs a property-testing harness (#1069); examples in src/test.rs cover this"]
fn worker_authority_never_widens() {
    todo!("requires the vault contract from #1068 (22.1)")
}
