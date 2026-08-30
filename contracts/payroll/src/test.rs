#![cfg(test)]

extern crate std;

use super::{Config, Disbursed, Error, Payroll, PayrollClient, Recipient, MAX_RECIPIENTS};
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
use soroban_sdk::{token, vec, Address, Env, Event as _, Vec};

const PERIOD: u64 = 30 * 24 * 60 * 60; // 30 days, the issue's own example
const START: u64 = 1_700_000_000;

struct Fixture<'a> {
    env: Env,
    client: PayrollClient<'a>,
    owner: Address,
    token: Address,
    token_admin: token::StellarAssetClient<'a>,
    token_client: token::TokenClient<'a>,
    contract_id: Address,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let owner = Address::generate(env);
    let issuer = Address::generate(env);
    let asset = env.register_stellar_asset_contract_v2(issuer);
    let token = asset.address();

    let contract_id = env.register(Payroll, ());

    Fixture {
        env: env.clone(),
        client: PayrollClient::new(env, &contract_id),
        owner,
        token: token.clone(),
        token_admin: token::StellarAssetClient::new(env, &token),
        token_client: token::TokenClient::new(env, &token),
        contract_id,
    }
}

fn recipients(env: &Env, specs: &[(Address, i128)]) -> Vec<Recipient> {
    let mut v = Vec::new(env);
    for (to, amount) in specs {
        v.push_back(Recipient {
            to: to.clone(),
            amount: *amount,
        });
    }
    v
}

/// Configure with two recipients and fund the contract with `funding`.
fn configured(f: &Fixture<'_>, funding: i128) -> (Address, Address) {
    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);
    f.client.configure(
        &f.owner,
        &f.token,
        &recipients(&f.env, &[(a.clone(), 600), (b.clone(), 400)]),
        &PERIOD,
    );
    if funding > 0 {
        let payer = Address::generate(&f.env);
        f.token_admin.mint(&payer, &funding);
        f.client.fund(&payer, &funding);
    }
    (a, b)
}

fn advance(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}

// --- the property the contract exists to demonstrate ------------------------

#[test]
fn disburse_succeeds_when_called_by_an_arbitrary_address() {
    let env = Env::default();
    let f = setup(&env);
    let (a, b) = configured(&f, 1_000);
    advance(&env, PERIOD);

    // No auth is mocked *for this call* beyond the blanket mock, and the
    // contract asks for none: `disburse` takes no address and calls no
    // `require_auth`. A stranger firing it is the whole point.
    let window = f.client.disburse();

    assert_eq!(window, 0);
    assert_eq!(f.token_client.balance(&a), 600);
    assert_eq!(f.token_client.balance(&b), 400);
    assert_eq!(f.token_client.balance(&f.contract_id), 0);
}

#[test]
fn disburse_requires_no_authorization_at_all() {
    // Same call, but with auth *not* mocked: an unauthorized environment must
    // still be able to fire it. If a `require_auth` is ever added to
    // `disburse`, this test fails and the design change is caught in review.
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 1_000);
    advance(&env, PERIOD);

    env.set_auths(&[]);
    assert_eq!(f.client.try_disburse(), Ok(Ok(0)));
}

// --- the four cases the issue names ----------------------------------------

#[test]
fn disburse_called_early_is_rejected_not_failed() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 1_000);

    // One second before the window opens.
    advance(&env, PERIOD - 1);
    assert_eq!(f.client.try_disburse(), Err(Ok(Error::NotDue)));

    // Nothing moved.
    assert_eq!(f.token_client.balance(&f.contract_id), 1_000);
    assert_eq!(f.client.next_window(), 0);
}

#[test]
fn disburse_with_insufficient_balance_pays_nobody() {
    let env = Env::default();
    let f = setup(&env);
    let (a, b) = configured(&f, 999); // one short of the 1,000 owed
    advance(&env, PERIOD);

    assert_eq!(f.client.try_disburse(), Err(Ok(Error::InsufficientBalance)));

    // All-or-nothing: a partial payroll is worse than a late one.
    assert_eq!(f.token_client.balance(&a), 0);
    assert_eq!(f.token_client.balance(&b), 0);
    assert_eq!(f.token_client.balance(&f.contract_id), 999);
    assert_eq!(f.client.next_window(), 0);
}

#[test]
fn disburse_twice_in_one_window_pays_once() {
    let env = Env::default();
    let f = setup(&env);
    let (a, _b) = configured(&f, 2_000); // funded for two windows
    advance(&env, PERIOD);

    assert_eq!(f.client.disburse(), 0);
    // Second call inside the same window: the window is consumed, and the next
    // one is not due yet.
    assert_eq!(f.client.try_disburse(), Err(Ok(Error::NotDue)));

    assert_eq!(f.token_client.balance(&a), 600);
    assert_eq!(f.token_client.balance(&f.contract_id), 1_000);
    assert_eq!(f.client.next_window(), 1);
}

#[test]
fn disburse_when_due_from_an_arbitrary_address_succeeds_across_windows() {
    let env = Env::default();
    let f = setup(&env);
    let (a, b) = configured(&f, 3_000);

    for expected_window in 0..3u64 {
        advance(&env, PERIOD);
        assert_eq!(f.client.disburse(), expected_window);
    }

    assert_eq!(f.token_client.balance(&a), 1_800);
    assert_eq!(f.token_client.balance(&b), 1_200);
    assert_eq!(f.client.next_window(), 3);
}

// --- the event ---------------------------------------------------------------

#[test]
fn disbursed_event_carries_the_window_identifier() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 2_000);

    // The test env's event buffer holds the most recent top-level invocation,
    // so each window is asserted right after the call that emitted it.
    let expected = |window: u64, window_start: u64| Disbursed {
        window,
        token: f.token.clone(),
        window_start,
        total: 1_000,
        recipients: 2,
    };

    advance(&env, PERIOD);
    f.client.disburse();
    let emitted = env.events().all().filter_by_contract(&f.contract_id);
    let emitted = emitted.events();
    assert_eq!(emitted.len(), 1);
    // 19.1 has to answer "did window 0 fire?" from the chain alone. The window
    // index is a topic, so that is a filter rather than a reconstruction.
    assert_eq!(emitted[0], expected(0, START).to_xdr(&env, &f.contract_id));

    advance(&env, PERIOD);
    f.client.disburse();
    let emitted = env.events().all().filter_by_contract(&f.contract_id);
    let emitted = emitted.events();
    assert_eq!(emitted.len(), 1);
    assert_eq!(
        emitted[0],
        expected(1, START + PERIOD).to_xdr(&env, &f.contract_id)
    );
}

// --- no path redirects funds ---------------------------------------------------

#[test]
fn withdraw_pays_the_configured_owner_and_takes_no_destination() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 1_000);

    f.client.withdraw(&400);

    // `withdraw` has no destination parameter to point elsewhere: the owner is
    // read from storage, which `configure` wrote once and nothing can rewrite.
    assert_eq!(f.token_client.balance(&f.owner), 400);
    assert_eq!(f.token_client.balance(&f.contract_id), 600);
}

#[test]
fn withdraw_requires_the_owner() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 1_000);

    env.set_auths(&[]);
    // Unauthorized: the host rejects the call rather than the contract
    // returning a typed error, so this is a panic rather than an Err.
    assert!(f.client.try_withdraw(&100).is_err());
    assert_eq!(f.token_client.balance(&f.contract_id), 1_000);
}

#[test]
fn configuration_is_immutable() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 0);

    let other = Address::generate(&env);
    let res = f.client.try_configure(
        &f.owner,
        &f.token,
        &recipients(&env, &[(other, 1)]),
        &PERIOD,
    );
    assert_eq!(res, Err(Ok(Error::AlreadyConfigured)));

    // A mutable recipient set would be authority over where the money goes.
    let config: Config = f.client.config();
    assert_eq!(config.recipients.len(), 2);
    assert_eq!(config.owner, f.owner);
}

// --- configuration guards -------------------------------------------------------

#[test]
fn unconfigured_calls_report_not_configured() {
    let env = Env::default();
    let f = setup(&env);

    assert_eq!(f.client.try_disburse(), Err(Ok(Error::NotConfigured)));
    assert_eq!(f.client.try_withdraw(&1), Err(Ok(Error::NotConfigured)));
    assert_eq!(
        f.client.try_fund(&Address::generate(&env), &1),
        Err(Ok(Error::NotConfigured))
    );
}

#[test]
fn configure_rejects_an_empty_or_oversized_recipient_set() {
    let env = Env::default();
    let f = setup(&env);

    assert_eq!(
        f.client
            .try_configure(&f.owner, &f.token, &Vec::new(&env), &PERIOD),
        Err(Ok(Error::InvalidRecipients))
    );

    let mut too_many = Vec::new(&env);
    for _ in 0..(MAX_RECIPIENTS + 1) {
        too_many.push_back(Recipient {
            to: Address::generate(&env),
            amount: 1,
        });
    }
    assert_eq!(
        f.client
            .try_configure(&f.owner, &f.token, &too_many, &PERIOD),
        Err(Ok(Error::InvalidRecipients))
    );
}

#[test]
fn configure_rejects_a_zero_period_and_non_positive_amounts() {
    let env = Env::default();
    let f = setup(&env);
    let to = Address::generate(&env);

    assert_eq!(
        f.client.try_configure(
            &f.owner,
            &f.token,
            &recipients(&env, &[(to.clone(), 1)]),
            &0
        ),
        Err(Ok(Error::InvalidPeriod))
    );
    assert_eq!(
        f.client
            .try_configure(&f.owner, &f.token, &recipients(&env, &[(to, 0)]), &PERIOD),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn next_due_at_tracks_the_window_a_worker_should_schedule_against() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 2_000);

    assert_eq!(f.client.next_due_at(), START + PERIOD);
    advance(&env, PERIOD);
    f.client.disburse();
    assert_eq!(f.client.next_due_at(), START + 2 * PERIOD);
}

#[test]
fn anyone_may_fund_a_payroll() {
    let env = Env::default();
    let f = setup(&env);
    configured(&f, 0);

    let stranger = Address::generate(&env);
    f.token_admin.mint(&stranger, &500);
    f.client.fund(&stranger, &500);

    assert_eq!(f.token_client.balance(&f.contract_id), 500);
    assert_eq!(
        f.client.try_fund(&stranger, &0),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn a_payroll_left_unfired_catches_up_one_window_per_call() {
    let env = Env::default();
    let f = setup(&env);
    let (a, _b) = configured(&f, 3_000);

    // Three periods pass with nobody firing the trigger.
    advance(&env, 3 * PERIOD);

    // Each window keeps its own call and its own event: the chain still says
    // which ones fired late rather than collapsing them into one payment.
    assert_eq!(f.client.disburse(), 0);
    assert_eq!(f.client.disburse(), 1);
    assert_eq!(f.client.disburse(), 2);
    assert_eq!(f.client.try_disburse(), Err(Ok(Error::NotDue)));

    assert_eq!(f.token_client.balance(&a), 1_800);
}

#[test]
fn vec_helper_matches_the_sdk_vec_macro() {
    // Guards the test fixture itself: `recipients` must build the same value
    // the sdk's own macro would, or every assertion above is testing the
    // helper rather than the contract.
    let env = Env::default();
    let to = Address::generate(&env);
    let built = recipients(&env, &[(to.clone(), 7)]);
    let expected = vec![&env, Recipient { to, amount: 7 }];
    assert_eq!(built, expected);
}
