#![no_std]

//! Placeholder crate for the Soroban vault contract.
//!
//! **This crate is deliberately empty.** It exists only so that
//! `tests/property.rs` and `tests/fuzz.rs` (issue #1069, "22.2 Vault
//! security audit and property tests") compile and are visible to `cargo
//! test`, as `#[ignore]`d specifications of the invariants the real vault
//! contract must uphold - not as a working implementation.
//!
//! The actual vault - the Soroban contract with hard constraints, storage,
//! and entry points - is issue #1068 ("22.1 Soroban vault contract with hard
//! constraints"), which is open and unstarted. This file is not a partial
//! implementation of it and should not be extended as if it were; #1068
//! replaces this file entirely. No `#[contract]`, no storage, no entry
//! points - none of that belongs here until 22.1 lands.
