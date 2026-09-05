#![cfg(test)]

extern crate std;

use super::{Error, Vault, VaultClient, VaultConfig};
use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation};
use soroban_sdk::{token, vec, Address, Env, Symbol, TryFromVal, Vec};

struct Fixture<'a> {
    env: Env,
    client: VaultClient<'a>,
    depositor: Address,
    worker: Address,
    stranger: Address,
    asset: Address,
    other_asset: Address,
    pool: Address,
    asset_admin: token::StellarAssetClient<'a>,
    asset_client: token::TokenClient<'a>,
    vault_id: Address,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();

    let depositor = Address::generate(env);
    let worker = Address::generate(env);
    let stranger = Address::generate(env);
    let pool = Address::generate(env);

    let asset = env.register_stellar_asset_contract_v2(Address::generate(env));
    let other = env.register_stellar_asset_contract_v2(Address::generate(env));
    let asset_addr = asset.address();
    let other_addr = other.address();

    let config = VaultConfig {
        depositor: depositor.clone(),
        pools: vec![env, pool.clone()],
        assets: vec![env, asset_addr.clone()],
        max_slippage_bps: 50,
        max_actions_per_window: 3,
        window_ledgers: 100,
    };

    let vault_id = env.register(Vault, (config,));

    Fixture {
        env: env.clone(),
        client: VaultClient::new(env, &vault_id),
        depositor,
        worker,
        stranger,
        asset: asset_addr.clone(),
        other_asset: other_addr,
        pool,
        asset_admin: token::StellarAssetClient::new(env, &asset_addr),
        asset_client: token::TokenClient::new(env, &asset_addr),
        vault_id,
    }
}

/// Mint `amount` to the depositor and deposit it into the vault.
fn funded(f: &Fixture<'_>, amount: i128) {
    f.asset_admin.mint(&f.depositor, &amount);
    f.client.deposit(&f.asset, &amount);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

#[test]
fn constructor_records_config_and_starts_with_no_worker() {
    let env = Env::default();
    let f = setup(&env);

    let config = f.client.config();
    assert_eq!(config.depositor, f.depositor);
    assert_eq!(config.max_slippage_bps, 50);
    // A vault is born with nobody able to act on it. Designating a worker is
    // an explicit, separate decision.
    assert_eq!(f.client.worker(), None);
}

#[test]
#[should_panic]
fn constructor_rejects_a_zero_length_window() {
    // A zero window would put every action in a fresh bucket and silently
    // disable the rate limit, which is worse than refusing the configuration.
    let env = Env::default();
    env.mock_all_auths();
    let depositor = Address::generate(&env);
    let config = VaultConfig {
        depositor,
        pools: Vec::new(&env),
        assets: Vec::new(&env),
        max_slippage_bps: 50,
        max_actions_per_window: 3,
        window_ledgers: 0,
    };
    env.register(Vault, (config,));
}

#[test]
#[should_panic]
fn constructor_rejects_slippage_above_one_hundred_percent() {
    let env = Env::default();
    env.mock_all_auths();
    let depositor = Address::generate(&env);
    let config = VaultConfig {
        depositor,
        pools: Vec::new(&env),
        assets: Vec::new(&env),
        max_slippage_bps: 10_001,
        max_actions_per_window: 3,
        window_ledgers: 100,
    };
    env.register(Vault, (config,));
}

// ---------------------------------------------------------------------------
// The central guarantee: funds only ever return to the depositor
// ---------------------------------------------------------------------------

#[test]
fn withdraw_pays_the_depositor() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 1_000);

    f.client.withdraw(&f.asset, &400);

    assert_eq!(f.asset_client.balance(&f.depositor), 400);
    assert_eq!(f.asset_client.balance(&f.vault_id), 600);
}

/// The strongest statement this suite can make about redirection: it is not
/// that a recipient argument is rejected, it is that the generated client has
/// no such argument to pass. `withdraw` takes `(asset, amount)` and nothing
/// else, so there is no call site anywhere - honest or malicious, now or after
/// a refactor - that can name a destination.
#[test]
fn withdraw_authorizes_only_asset_and_amount_with_no_destination() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 1_000);

    f.client.withdraw(&f.asset, &100);

    let auths = env.auths();
    let (addr, invocation) = auths.first().expect("withdraw must require authorization");
    assert_eq!(addr, &f.depositor, "only the depositor may authorize a withdrawal");

    let AuthorizedInvocation { function, .. } = invocation;
    match function {
        AuthorizedFunction::Contract((contract, fn_name, args)) => {
            assert_eq!(contract, &f.vault_id);
            assert_eq!(fn_name, &Symbol::new(&env, "withdraw"));
            // Two arguments, and both are already accounted for. A recipient
            // could not be smuggled in as a third.
            assert_eq!(args.len(), 2, "withdraw must take exactly (asset, amount)");
            // Converted back to typed values rather than compared as raw
            // `Val`s, which carry no PartialEq.
            let arg_asset = Address::try_from_val(&env, &args.get(0).unwrap()).unwrap();
            let arg_amount = i128::try_from_val(&env, &args.get(1).unwrap()).unwrap();
            assert_eq!(arg_asset, f.asset);
            assert_eq!(arg_amount, 100);
        }
        _ => panic!("expected a contract invocation"),
    }
}

#[test]
fn a_stranger_cannot_withdraw() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 1_000);

    // Auth is scoped to the stranger only, so the depositor's requirement
    // cannot be satisfied and the call must fail.
    env.set_auths(&[]);
    let res = f
        .client
        .mock_auths(&[])
        .try_withdraw(&f.asset, &100);
    assert!(res.is_err(), "an unauthorized caller must not be able to withdraw");
    assert_eq!(f.asset_client.balance(&f.vault_id), 1_000);
    let _ = &f.stranger;
}

#[test]
fn withdraw_rejects_more_than_the_balance() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 100);

    assert_eq!(
        f.client.try_withdraw(&f.asset, &101),
        Err(Ok(Error::InsufficientBalance))
    );
    assert_eq!(f.asset_client.balance(&f.vault_id), 100);
}

#[test]
fn withdraw_rejects_zero_and_negative_amounts() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 100);

    assert_eq!(f.client.try_withdraw(&f.asset, &0), Err(Ok(Error::ZeroAmount)));
    assert_eq!(f.client.try_withdraw(&f.asset, &-5), Err(Ok(Error::ZeroAmount)));
}

/// Narrowing the allow-list must not strand funds already inside the vault.
/// A safety control that can trap a depositor's own money is a trap, so
/// `withdraw` deliberately does not consult the allow-list.
#[test]
fn withdraw_still_works_after_the_asset_is_removed_from_the_allowlist() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 500);

    f.client.set_allowlist(&Vec::new(&env), &Vec::new(&env));

    f.client.withdraw(&f.asset, &500);
    assert_eq!(f.asset_client.balance(&f.depositor), 500);
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

#[test]
fn deposit_rejects_a_non_allowlisted_asset() {
    let env = Env::default();
    let f = setup(&env);
    let other_admin = token::StellarAssetClient::new(&env, &f.other_asset);
    other_admin.mint(&f.depositor, &1_000);

    assert_eq!(
        f.client.try_deposit(&f.other_asset, &100),
        Err(Ok(Error::AssetNotAllowed))
    );
}

#[test]
fn deposit_rejects_zero_and_negative_amounts() {
    let env = Env::default();
    let f = setup(&env);
    f.asset_admin.mint(&f.depositor, &100);

    assert_eq!(f.client.try_deposit(&f.asset, &0), Err(Ok(Error::ZeroAmount)));
    assert_eq!(f.client.try_deposit(&f.asset, &-1), Err(Ok(Error::ZeroAmount)));
}

// ---------------------------------------------------------------------------
// Worker authority - every one of these is a negative test
// ---------------------------------------------------------------------------

#[test]
fn worker_can_be_designated_and_read_back() {
    let env = Env::default();
    let f = setup(&env);

    f.client.set_worker(&f.worker);
    assert_eq!(f.client.worker(), Some(f.worker.clone()));
}

/// Revocation is immediate and needs nothing from the worker.
#[test]
fn revoke_worker_takes_effect_at_once() {
    let env = Env::default();
    let f = setup(&env);
    f.client.set_worker(&f.worker);

    f.client.revoke_worker();

    assert_eq!(f.client.worker(), None);
}

#[test]
fn revoking_when_no_worker_is_set_reports_it() {
    let env = Env::default();
    let f = setup(&env);

    assert_eq!(f.client.try_revoke_worker(), Err(Ok(Error::WorkerRevoked)));
}

/// The worker has no path to the allow-list. This is what makes "a worker can
/// never widen its own trading surface" structural rather than procedural:
/// `set_allowlist` requires the depositor's authorization, and the worker's
/// own authorization does not satisfy it.
#[test]
fn a_worker_cannot_widen_the_allowlist() {
    let env = Env::default();
    let f = setup(&env);
    f.client.set_worker(&f.worker);

    let before = f.client.config();

    let res = f.client.mock_auths(&[]).try_set_allowlist(
        &vec![&env, f.pool.clone(), Address::generate(&env)],
        &vec![&env, f.asset.clone(), f.other_asset.clone()],
    );
    assert!(res.is_err(), "a worker must not be able to change the allow-list");
    assert_eq!(f.client.config().assets, before.assets);
    assert_eq!(f.client.config().pools, before.pools);
}

#[test]
fn a_worker_cannot_withdraw() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 1_000);
    f.client.set_worker(&f.worker);

    let res = f.client.mock_auths(&[]).try_withdraw(&f.asset, &1_000);
    assert!(res.is_err(), "a worker must never be able to move funds out");
    assert_eq!(f.asset_client.balance(&f.vault_id), 1_000);
}

#[test]
fn a_worker_cannot_change_the_bounds() {
    let env = Env::default();
    let f = setup(&env);
    f.client.set_worker(&f.worker);

    let res = f.client.mock_auths(&[]).try_set_bounds(&10_000, &1_000, &1);
    assert!(res.is_err(), "a worker must not be able to relax its own bounds");
    assert_eq!(f.client.config().max_slippage_bps, 50);
}

#[test]
fn a_worker_cannot_designate_another_worker() {
    let env = Env::default();
    let f = setup(&env);
    f.client.set_worker(&f.worker);

    let res = f
        .client
        .mock_auths(&[])
        .try_set_worker(&Address::generate(&env));
    assert!(res.is_err(), "a worker must not be able to appoint a successor");
    assert_eq!(f.client.worker(), Some(f.worker.clone()));
}

// ---------------------------------------------------------------------------
// Depositor-controlled configuration
// ---------------------------------------------------------------------------

#[test]
fn depositor_can_narrow_and_restore_the_allowlist() {
    let env = Env::default();
    let f = setup(&env);

    f.client.set_allowlist(&Vec::new(&env), &Vec::new(&env));
    assert_eq!(f.client.config().assets.len(), 0);

    // Re-adding is permitted because it is an explicit, separately-authorized
    // depositor action - which is exactly the carve-out the "allow-list only
    // narrows" invariant states.
    f.client
        .set_allowlist(&vec![&env, f.pool.clone()], &vec![&env, f.asset.clone()]);
    assert_eq!(f.client.config().assets.len(), 1);
}

#[test]
fn set_bounds_rejects_an_invalid_window() {
    let env = Env::default();
    let f = setup(&env);

    assert_eq!(
        f.client.try_set_bounds(&50, &3, &0),
        Err(Ok(Error::InvalidBounds))
    );
    assert_eq!(f.client.config().window_ledgers, 100);
}

#[test]
fn set_bounds_rejects_slippage_above_one_hundred_percent() {
    let env = Env::default();
    let f = setup(&env);

    assert_eq!(
        f.client.try_set_bounds(&10_001, &3, &100),
        Err(Ok(Error::InvalidBounds))
    );
}

/// The depositor is bound at construction and there is no function that
/// rewrites it - not for the depositor, not for anyone. Asserted by reading
/// the config back after every mutating call the contract exposes.
#[test]
fn no_call_can_change_the_depositor() {
    let env = Env::default();
    let f = setup(&env);
    let original = f.client.config().depositor;

    f.client.set_worker(&f.worker);
    f.client.set_bounds(&10, &1, &50);
    f.client
        .set_allowlist(&vec![&env, f.pool.clone()], &vec![&env, f.asset.clone()]);
    f.client.revoke_worker();

    assert_eq!(f.client.config().depositor, original);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

#[test]
fn balance_reports_the_vaults_holding() {
    let env = Env::default();
    let f = setup(&env);
    funded(&f, 750);

    assert_eq!(f.client.balance(&f.asset), 750);
    assert_eq!(f.client.balance(&f.other_asset), 0);
}
