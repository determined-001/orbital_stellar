#![no_std]

//! Reference payroll contract — the canonical example of the worker layer's
//! first rule: **the trigger is not the custodian**
//! (see `docs/design/workers.md`).
//!
//! `disburse()` takes no caller authorization. It checks its own conditions —
//! the window has elapsed, the balance is sufficient, recipients are
//! configured — and does not care who called it. A worker, the payroll owner,
//! a recipient, or a stranger produce identical results.
//!
//! That is the whole argument for the layer existing. If every Orbital worker
//! vanished tomorrow, payroll runs late and nothing is stolen: the only thing
//! a caller controls is *when* a payment that was already going to happen
//! happens. Funds can only go where `configure()` already said they go, and
//! `withdraw()` takes no destination at all, so no call path lets any caller
//! redirect money.
//!
//! It exists as running code rather than prose because the property is easy to
//! claim and easy to erode; here it is enforced by the absence of a
//! `require_auth` and by the shape of the signatures, and a test asserts a
//! stranger can fire it.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

// Instance storage is bumped on every touch so a live payroll cannot archive
// out from under itself between windows. Mirrors the registry contract's
// policy: ~30 days of ledgers at Stellar's ~5s close time, refreshed once the
// entry is within a day of expiring.
const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Upper bound on the recipient set, so `disburse()`'s cost stays bounded and
/// predictable. A payroll that outgrows this splits across contracts rather
/// than making the permissionless call unaffordable to fire.
pub const MAX_RECIPIENTS: u32 = 25;

/// Every failure mode is typed, because the submitter has to tell
/// **rejected** from **failed**.
///
/// A worker that calls early gets `NotDue`: the contract worked exactly as
/// designed and the call should not be retried until the window opens. A
/// worker that treats that as a failure will retry, alert, and eventually page
/// somebody at 3am about a contract behaving correctly. `InsufficientBalance`
/// is the one error here that is a real operational problem, and it is
/// distinct for that reason.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `configure()` has not been called; there is nothing to disburse.
    NotConfigured = 1,
    /// `configure()` has already been called. Configuration is immutable —
    /// a mutable recipient set is authority over where funds go, held by
    /// whoever can mutate it.
    AlreadyConfigured = 2,
    /// The current window has not elapsed yet. **Rejected, not failed**:
    /// retry after `next_due_at()`.
    NotDue = 3,
    /// The contract's token balance does not cover the full recipient set.
    /// Payroll is all-or-nothing — see `disburse`.
    InsufficientBalance = 4,
    /// The recipient set was empty, or larger than `MAX_RECIPIENTS`.
    InvalidRecipients = 5,
    /// A period of zero seconds, which would make every window due at once.
    InvalidPeriod = 6,
    /// A zero or negative amount.
    InvalidAmount = 7,
}

/// One payroll line: a fixed address, a fixed amount, both set at configure
/// time and never mutable afterwards.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recipient {
    pub to: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// The only address `withdraw()` can ever pay.
    pub owner: Address,
    pub token: Address,
    pub recipients: Vec<Recipient>,
    /// Length of one payroll window, in seconds.
    pub period: u64,
    /// Ledger timestamp at `configure()`. Window `k` is due at
    /// `start + (k + 1) * period`.
    pub start: u64,
}

#[contracttype]
enum DataKey {
    Config,
    /// Index of the next window to be paid. Incremented by `disburse()`.
    NextWindow,
}

/// Emitted on every successful disbursement.
///
/// `window` is the load-bearing field: it is the window index just paid, which
/// makes "did window 7 fire?" answerable **from the chain alone** by a
/// verifier that holds nothing but this contract's address. Emitting a bare
/// "disbursed" would force a reconstruction from timestamps and period
/// arithmetic that nobody wants to maintain.
///
/// Declared with `#[contractevent]`, following the registry contract, so the
/// schema is carried in the contract's own WASM spec and resolves through the
/// registry's introspection path rather than needing a hand-maintained copy.
#[contractevent]
#[derive(Clone, Debug)]
pub struct Disbursed {
    #[topic]
    pub window: u64,
    #[topic]
    pub token: Address,
    /// Start of the window that was paid, as a ledger timestamp.
    pub window_start: u64,
    /// Sum actually transferred across the recipient set.
    pub total: i128,
    pub recipients: u32,
}

fn bump(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
}

fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get::<DataKey, Config>(&DataKey::Config)
        .ok_or(Error::NotConfigured)
}

#[contract]
pub struct Payroll;

#[contractimpl]
impl Payroll {
    /// One-time setup. Requires `owner`'s authorization, and is the only place
    /// the recipient set is ever written.
    ///
    /// Immutable on purpose: a `set_recipients()` would be authority over
    /// where the money goes, and whoever held it — including a compromised
    /// owner key — could redirect an entire payroll without touching this
    /// contract's permissionless half. A payroll that needs to change deploys
    /// a new instance and withdraws from the old one.
    pub fn configure(
        env: Env,
        owner: Address,
        token: Address,
        recipients: Vec<Recipient>,
        period: u64,
    ) -> Result<(), Error> {
        owner.require_auth();

        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyConfigured);
        }
        if recipients.is_empty() || recipients.len() > MAX_RECIPIENTS {
            return Err(Error::InvalidRecipients);
        }
        if period == 0 {
            return Err(Error::InvalidPeriod);
        }
        for r in recipients.iter() {
            if r.amount <= 0 {
                return Err(Error::InvalidAmount);
            }
        }

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                owner,
                token,
                recipients,
                period,
                start: env.ledger().timestamp(),
            },
        );
        env.storage().instance().set(&DataKey::NextWindow, &0u64);
        bump(&env);
        Ok(())
    }

    /// Move `amount` of the configured token from `from` into this contract.
    ///
    /// Requires `from`'s authorization because it spends `from`'s tokens —
    /// that is authorization over the *sender's* funds, granted by the sender,
    /// which is the opposite of the contract holding authority over anyone.
    /// Anyone may fund a payroll.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = load_config(&env)?;

        let contract = env.current_contract_address();
        token::TokenClient::new(&env, &config.token).transfer(&from, &contract, &amount);
        bump(&env);
        Ok(())
    }

    /// Pay the next due window. **Callable by anyone — no authorization.**
    ///
    /// The three conditions are checked here rather than trusted to the
    /// caller: the window has elapsed, the recipient set is configured, and
    /// the balance covers it. Nothing about the call depends on who made it,
    /// and nothing in the arguments — there are none — can influence where the
    /// money goes.
    ///
    /// All-or-nothing: if the balance does not cover the whole set, nothing is
    /// paid. A partial payroll silently underpaying some employees and not
    /// others is a worse outcome than a late one, and a late one is what the
    /// worker layer's third rule promises.
    ///
    /// Windows are paid strictly in order, one per call. A payroll left unfired
    /// for three periods catches up over three calls rather than collapsing
    /// three windows into one payment — every window keeps its own event, so
    /// the chain still says which ones fired late.
    pub fn disburse(env: Env) -> Result<u64, Error> {
        let config = load_config(&env)?;
        let window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextWindow)
            .unwrap_or(0);

        let window_start = config.start + window * config.period;
        let due_at = window_start + config.period;
        if env.ledger().timestamp() < due_at {
            return Err(Error::NotDue);
        }

        let mut total: i128 = 0;
        for r in config.recipients.iter() {
            total += r.amount;
        }

        let client = token::TokenClient::new(&env, &config.token);
        if client.balance(&env.current_contract_address()) < total {
            return Err(Error::InsufficientBalance);
        }

        // The window is advanced before any transfer, so a re-entrant token
        // that called back into `disburse()` would find the window already
        // consumed rather than paying it twice.
        env.storage()
            .instance()
            .set(&DataKey::NextWindow, &(window + 1));

        let contract = env.current_contract_address();
        for r in config.recipients.iter() {
            client.transfer(&contract, &r.to, &r.amount);
        }

        Disbursed {
            window,
            token: config.token.clone(),
            window_start,
            total,
            recipients: config.recipients.len(),
        }
        .publish(&env);

        bump(&env);
        Ok(window)
    }

    /// Return `amount` to the configured owner.
    ///
    /// There is deliberately **no destination parameter.** The owner is read
    /// from storage, where `configure()` put it and nothing can change it, so
    /// there is no call path — for the owner, a worker, or anyone else — that
    /// sends these funds anywhere other than the owner's address.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), Error> {
        let config = load_config(&env)?;
        config.owner.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let client = token::TokenClient::new(&env, &config.token);
        if client.balance(&env.current_contract_address()) < amount {
            return Err(Error::InsufficientBalance);
        }

        client.transfer(&env.current_contract_address(), &config.owner, &amount);
        bump(&env);
        Ok(())
    }

    /// The configuration, for a verifier that wants to check a `Disbursed`
    /// event against the terms it was emitted under.
    pub fn config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }

    /// Index of the next window to be paid.
    pub fn next_window(env: Env) -> Result<u64, Error> {
        load_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::NextWindow)
            .unwrap_or(0))
    }

    /// Ledger timestamp at which the next window becomes payable. A worker
    /// schedules against this instead of guessing, which is what keeps
    /// `NotDue` rare rather than routine.
    pub fn next_due_at(env: Env) -> Result<u64, Error> {
        let config = load_config(&env)?;
        let window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextWindow)
            .unwrap_or(0);
        Ok(config.start + (window + 1) * config.period)
    }
}

mod test;
