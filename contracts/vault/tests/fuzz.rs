//! Fuzz-test specification for the vault contract (issue #1069, "22.2 Vault
//! security audit and property tests").
//!
//! **This does not run.** Same reason as `tests/property.rs`: `contracts/
//! vault` has no contract yet (#1068/22.1 is open and unstarted), so there
//! is no deposit/withdraw/action sequence to fuzz. The single test below is
//! `#[ignore]`d and documents the fuzzing plan rather than fuzzing anything.
//!
//! Real fuzzing here means, once the contract exists:
//!
//! - Randomly generated sequences of `deposit`, `withdraw`, and worker
//!   `action` calls, checked after every step against the four invariants
//!   in `tests/property.rs`.
//! - **Interleaved orderings**: two or more call sequences (e.g. a deposit
//!   racing a withdraw, or two workers acting concurrently) executed in
//!   every relative order the fuzzer can construct, not just the
//!   sequential case a hand-written test would think to check.
//! - **Reentrant orderings**: a call sequence where one operation
//!   (typically a worker `action` or a `withdraw`) triggers a callback or
//!   cross-contract call that re-enters the vault before the original call
//!   completes. Soroban's cross-contract call model constrains what
//!   reentrancy is even possible, but "constrained" is not "impossible" -
//!   the fuzzer's job is to find the state, if any, where an interleaving
//!   defeats an invariant a sequential test would never construct.
//!
//! No `cargo-fuzz` or `proptest` dependency is added by this issue - see
//! `tests/property.rs`'s module doc for why: there is nothing yet to point
//! either tool at. 22.1's implementation (or a follow-up to this issue) is
//! where that tooling and its corpus/generators belong.

#[test]
#[ignore = "no vault contract exists yet (#1068/22.1) - see the module doc for the fuzzing plan"]
fn deposit_withdraw_action_sequences_never_violate_an_invariant() {
    todo!("requires the vault contract from #1068 (22.1), plus cargo-fuzz or proptest wiring")
}
