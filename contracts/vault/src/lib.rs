#![no_std]

//! Soroban vault with hard constraints (issue #1068, "22.1").
//!
//! §C.2 rule 3, in code. A subscriber deposits here and designates a worker.
//! The worker's entire authority is "call one constrained function"; it can
//! never decide where money goes. This contract is the reason the worker layer
//! is not a custody product wearing a different name - if it is weak, nothing
//! above it is safe.
//!
//! **The guarantees are structural, not procedural.** They hold because of what
//! the interface does *not* expose:
//!
//! - `withdraw` has **no recipient parameter**. Not one that is validated - one
//!   that does not exist. It pays `config.depositor`, loaded from storage. A
//!   reviewer can confirm funds cannot be redirected from the signature alone,
//!   and no future refactor can relax a check that was never written.
//! - No function that moves money is callable by the worker except `act`, and
//!   `act`'s output lands in this vault, always.
//! - The worker is read from storage on every call, so `revoke_worker` takes
//!   effect at the very next invocation - no settlement delay, no drain window,
//!   no cooperation from the worker required. That is precisely the property
//!   that matters during an incident.
//! - There is no upgrade entrypoint and no pause. An upgradable vault has
//!   whatever guarantees its upgrade authority says tomorrow; an operator pause
//!   is an operator who can freeze user funds. Migration is the depositor
//!   withdrawing and re-depositing, which only they can do.
//!
//! ## Scope: `act()` is deliberately absent
//!
//! Every custody guarantee above is implemented and negatively tested here.
//! The one function still missing is `act()` - the constrained action the
//! worker calls - because open question 3 in `docs/design/vault-pattern.md`
//! is unresolved: whether `act` binds to a specific AMM interface (safer,
//! narrower) or takes an opaque selector constrained by the allow-list
//! (survives a new AMM without a redeploy). That choice changes the function's
//! shape, its storage, and its tests.
//!
//! A stub would be worse than an absence. An `act` that exists but panics
//! reads, to anything scanning the interface, like a real entry point; its
//! absence cannot be misread. The allow-list, bounds and rate-limit state it
//! will consume are all defined and enforced here, so adding it is additive.
//!
//! Until `act` lands, this vault is a depositor-only safe with a designated -
//! but powerless - worker. That is a coherent and safe intermediate state, not
//! a half-built one.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

// ~5s ledger close time, so 17_280 ledgers is about a day.
const DAY_IN_LEDGERS: u32 = 17_280;

/// The network's `max_entry_ttl`, in ledgers. Asking for more than the network
/// allows makes the host reject the extension outright. Verified against both
/// networks by reading `ConfigSettingId` 10 over Soroban RPC - see
/// `contracts/registry/src/lib.rs` for the exact query and the reasoning. This
/// is a validator-votable setting, not a protocol constant; re-check before
/// raising it.
const MAX_ENTRY_TTL: u32 = 3_110_400;
const BUMP_AMOUNT: u32 = MAX_ENTRY_TTL;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No `__constructor` has run, so there is no depositor to protect.
    NotInitialized = 1,
    AlreadyInitialized = 2,
    /// Caller is not the depositor recorded at construction.
    NotDepositor = 3,
    NotWorker = 4,
    /// A worker was designated and then revoked, or never designated.
    WorkerRevoked = 5,
    PoolNotAllowed = 6,
    AssetNotAllowed = 7,
    SlippageExceeded = 8,
    ActionLimitReached = 9,
    InsufficientBalance = 10,
    ZeroAmount = 11,
    /// A bound was configured outside its representable range.
    InvalidBounds = 12,
}

/// Vault configuration. Every field is depositor-controlled; no path in this
/// contract lets a worker write any of it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    /// Set once at construction. Never mutable, by any path, including by the
    /// depositor - a vault whose owner can change is a vault that can be sold
    /// out from under the funds inside it.
    pub depositor: Address,
    /// Allow-listed liquidity pools. Depositor-only.
    pub pools: Vec<Address>,
    /// Allow-listed assets. Depositor-only.
    pub assets: Vec<Address>,
    /// Max tolerated slippage in basis points, enforced on chain by `act`.
    pub max_slippage_bps: u32,
    /// Max actions the worker may take per window. A drain assembled from many
    /// individually-legal actions is still a drain.
    pub max_actions_per_window: u32,
    pub window_ledgers: u32,
}

/// Rolling action-rate state. Ledger-based rather than wall-clock: it needs no
/// oracle and cannot be manipulated by a timestamp, at the cost of drifting
/// against real time as close times vary.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionWindow {
    pub started_at_ledger: u32,
    pub count: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    /// Present only while a worker is designated. `revoke_worker` removes it,
    /// which is why revocation cannot be half-applied.
    Worker,
    Window,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    pub asset: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    pub asset: Address,
    /// Always the depositor. Emitted so the audit trail carries the
    /// destination explicitly, even though it could never have been anything
    /// else.
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkerSet {
    pub worker: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkerRevoked {
    pub worker: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowlistUpdated {
    pub pools: u32,
    pub assets: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundsUpdated {
    pub max_slippage_bps: u32,
    pub max_actions_per_window: u32,
    pub window_ledgers: u32,
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    /// Binds the depositor permanently and records the initial bounds.
    pub fn __constructor(env: Env, config: VaultConfig) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        validate_bounds(&config)?;
        env.storage().instance().set(&DataKey::Config, &config);
        bump(&env);
        Ok(())
    }

    /// Move `amount` of `asset` from the depositor into this vault.
    ///
    /// Depositor-only. A third party topping up someone else's vault is
    /// plausible but is not enabled here: it is easier to widen this later
    /// than to narrow it after someone depends on the wider behaviour.
    pub fn deposit(env: Env, asset: Address, amount: i128) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.depositor.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if !config.assets.contains(&asset) {
            return Err(Error::AssetNotAllowed);
        }

        token::TokenClient::new(&env, &asset).transfer(
            &config.depositor,
            &env.current_contract_address(),
            &amount,
        );

        bump(&env);
        Deposited { asset, amount }.publish(&env);
        Ok(())
    }

    /// Return `amount` of `asset` to the depositor.
    ///
    /// **There is no recipient parameter.** The destination is
    /// `config.depositor`, read from storage, and no argument can influence it.
    ///
    /// Note the deliberate absence of an allow-list check: an asset that was
    /// allow-listed at deposit time and removed afterwards must still be
    /// retrievable. Gating withdrawal on the allow-list would let a depositor
    /// strand their own funds by narrowing their own configuration - turning a
    /// safety control into a trap.
    pub fn withdraw(env: Env, asset: Address, amount: i128) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.depositor.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let contract = env.current_contract_address();
        let client = token::TokenClient::new(&env, &asset);
        if client.balance(&contract) < amount {
            return Err(Error::InsufficientBalance);
        }

        client.transfer(&contract, &config.depositor, &amount);

        bump(&env);
        Withdrawn {
            asset,
            to: config.depositor,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Designate the worker permitted to call `act`. Replaces any existing one.
    pub fn set_worker(env: Env, worker: Address) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.depositor.require_auth();

        env.storage().instance().set(&DataKey::Worker, &worker);
        bump(&env);
        WorkerSet { worker }.publish(&env);
        Ok(())
    }

    /// Withdraw the worker's permission. Unilateral and immediate.
    ///
    /// `act` loads the worker from storage on every call, so this takes effect
    /// at the next invocation with no settlement delay and no cooperation from
    /// the worker.
    pub fn revoke_worker(env: Env) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.depositor.require_auth();

        let worker: Address = env
            .storage()
            .instance()
            .get(&DataKey::Worker)
            .ok_or(Error::WorkerRevoked)?;

        env.storage().instance().remove(&DataKey::Worker);
        bump(&env);
        WorkerRevoked { worker }.publish(&env);
        Ok(())
    }

    /// Replace the allow-lists wholesale. Depositor-only; the worker has no
    /// path to this function, which is what makes "the worker cannot widen its
    /// own trading surface" true at the contract level.
    pub fn set_allowlist(env: Env, pools: Vec<Address>, assets: Vec<Address>) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.depositor.require_auth();

        let event = AllowlistUpdated {
            pools: pools.len(),
            assets: assets.len(),
        };
        config.pools = pools;
        config.assets = assets;
        env.storage().instance().set(&DataKey::Config, &config);

        bump(&env);
        event.publish(&env);
        Ok(())
    }

    /// Adjust the enforced bounds. Depositor-only.
    pub fn set_bounds(
        env: Env,
        max_slippage_bps: u32,
        max_actions_per_window: u32,
        window_ledgers: u32,
    ) -> Result<(), Error> {
        let mut config = load_config(&env)?;
        config.depositor.require_auth();

        config.max_slippage_bps = max_slippage_bps;
        config.max_actions_per_window = max_actions_per_window;
        config.window_ledgers = window_ledgers;
        validate_bounds(&config)?;
        env.storage().instance().set(&DataKey::Config, &config);

        bump(&env);
        BoundsUpdated {
            max_slippage_bps,
            max_actions_per_window,
            window_ledgers,
        }
        .publish(&env);
        Ok(())
    }

    // --- read-only ---------------------------------------------------------
    //
    // Read paths deliberately do not extend any TTL. A read that writes turns
    // every lookup into a signed, fee-paying transaction and makes simulation
    // against an unfunded source impossible.

    pub fn config(env: Env) -> Result<VaultConfig, Error> {
        load_config(&env)
    }

    /// The designated worker, or `None` if never set or since revoked.
    pub fn worker(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Worker)
    }

    pub fn balance(env: Env, asset: Address) -> i128 {
        token::TokenClient::new(&env, &asset).balance(&env.current_contract_address())
    }

    /// Current action-rate window. Exposed so an operator can see how close a
    /// worker is to its limit without inferring it from event history.
    pub fn action_window(env: Env) -> Option<ActionWindow> {
        env.storage().instance().get(&DataKey::Window)
    }
}

fn load_config(env: &Env) -> Result<VaultConfig, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

/// `window_ledgers` of zero would make every action fall in a fresh window and
/// defeat the rate limit entirely, so it is rejected rather than silently
/// treated as "unlimited".
fn validate_bounds(config: &VaultConfig) -> Result<(), Error> {
    if config.max_slippage_bps > 10_000 {
        return Err(Error::InvalidBounds);
    }
    if config.window_ledgers == 0 {
        return Err(Error::InvalidBounds);
    }
    Ok(())
}

fn bump(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

#[cfg(test)]
mod test;
