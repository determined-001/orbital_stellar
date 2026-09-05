#![cfg(test)]

extern crate std;

use super::{AbiRegistry, AbiRegistryClient, DataKey, Error, BUMP_AMOUNT, DAY_IN_LEDGERS, MAX_ENTRY_TTL, MAX_PAGE_SIZE};
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::Vec;
use soroban_sdk::{Address, BytesN, Env, String};
use std::fs;
use std::path::PathBuf;

fn setup(env: &Env) -> AbiRegistryClient<'_> {
    let contract_id = env.register(AbiRegistry, ());
    AbiRegistryClient::new(env, &contract_id)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Version strings for the paging tests, indexed by publish order.
///
/// The crate is `#![no_std]` with no `alloc`, so `format!` is unavailable here -
/// these are table-driven instead. Index 0 is unused; callers pass 1-based `i`.
const VERSION_STRINGS: [&str; 31] = [
    "0.0.0", "1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0", "7.0.0", "8.0.0", "9.0.0",
    "10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0", "18.0.0",
    "19.0.0", "20.0.0", "21.0.0", "22.0.0", "23.0.0", "24.0.0", "25.0.0", "26.0.0", "27.0.0",
    "28.0.0", "29.0.0", "30.0.0",
];

fn version_str(env: &Env, i: u32) -> String {
    String::from_str(env, VERSION_STRINGS[i as usize])
}

#[test]
fn publish_then_resolve_latest_and_get_version() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let spec_hash = hash(&env, 1);

    client.publish(&publisher, &contract_id, &version, &spec_hash, &pointer);

    let latest = client.latest(&contract_id, &publisher).unwrap();
    assert_eq!(latest.version, version);
    assert_eq!(latest.spec_hash, spec_hash);
    assert_eq!(latest.pointer, pointer);
    assert_eq!(latest.publisher, publisher);

    let fetched = client
        .get_version(&contract_id, &publisher, &version)
        .unwrap();
    assert_eq!(fetched, latest);
}

#[test]
fn republishing_same_version_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let spec_hash = hash(&env, 1);

    client.publish(&publisher, &contract_id, &version, &spec_hash, &pointer);

    let result = client.try_publish(&publisher, &contract_id, &version, &spec_hash, &pointer);
    assert_eq!(result, Err(Ok(Error::AlreadyPublished)));
}

#[test]
fn multiple_versions_are_listed_oldest_first_and_latest_tracks_most_recent() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");

    let v1 = String::from_str(&env, "1.0.0");
    let v2 = String::from_str(&env, "2.0.0");

    client.publish(&publisher, &contract_id, &v1, &hash(&env, 1), &pointer);
    client.publish(&publisher, &contract_id, &v2, &hash(&env, 2), &pointer);

    let versions = client.list_versions(&contract_id, &publisher);
    assert_eq!(versions.len(), 2);
    assert_eq!(versions.get(0).unwrap(), v1);
    assert_eq!(versions.get(1).unwrap(), v2);

    let latest = client.latest(&contract_id, &publisher).unwrap();
    assert_eq!(latest.version, v2);
}

#[test]
fn different_publishers_are_independently_scoped() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let contract_id = Address::generate(&env);
    let publisher_a = Address::generate(&env);
    let publisher_b = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let pointer = String::from_str(&env, "https://example.com/a.json");

    client.publish(
        &publisher_a,
        &contract_id,
        &version,
        &hash(&env, 1),
        &pointer,
    );

    assert!(client.latest(&contract_id, &publisher_b).is_none());
    assert!(client.latest(&contract_id, &publisher_a).is_some());
}

#[test]
fn unknown_contract_or_version_resolves_to_none() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");

    assert!(client.latest(&contract_id, &publisher).is_none());
    assert!(client
        .get_version(&contract_id, &publisher, &version)
        .is_none());
    assert_eq!(client.list_versions(&contract_id, &publisher).len(), 0);
}

#[test]
fn list_versions_paged_empty_set() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let (versions, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &10u32);
    assert_eq!(versions.len(), 0);
    assert_eq!(next, None);
}

#[test]
fn list_versions_paged_exactly_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let limit = 5u32;

    for i in 1..=limit {
        let version = version_str(&env, i);
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    let (versions, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &limit);
    assert_eq!(versions.len(), limit);
    assert_eq!(next, None); // exactly limit = no more pages

    // Verify order: oldest first
    assert_eq!(versions.get(0).unwrap(), String::from_str(&env, "1.0.0"));
    assert_eq!(
        versions.get(limit - 1).unwrap(),
        String::from_str(&env, "5.0.0")
    );
}

#[test]
fn list_versions_paged_limit_plus_one() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let limit = 3u32; // request 3, publish 4

    for i in 1..=4 {
        let version = version_str(&env, i);
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    let (page1, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &limit);
    assert_eq!(page1.len(), limit);
    assert_eq!(next, Some(limit)); // cursor points to next page start

    // Fetch second page
    let (page2, next2) =
        client.list_versions_paged(&contract_id, &publisher, &next.unwrap(), &limit);
    assert_eq!(page2.len(), 1);
    assert_eq!(next2, None);
    assert_eq!(page2.get(0).unwrap(), String::from_str(&env, "4.0.0"));
}

#[test]
fn list_versions_paged_start_past_end() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");

    let version = String::from_str(&env, "1.0.0");
    client.publish(&publisher, &contract_id, &version, &hash(&env, 1), &pointer);

    // Start at index 10 when only 1 version exists
    let (versions, next) = client.list_versions_paged(&contract_id, &publisher, &10u32, &5u32);
    assert_eq!(versions.len(), 0);
    assert_eq!(next, None);
}

#[test]
fn list_versions_paged_max_page_size_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");

    // Publish 30 versions
    for i in 1..=30 {
        let version = version_str(&env, i);
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    // Request 100, but should be capped at MAX_PAGE_SIZE (25)
    let (page, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &100u32);
    assert_eq!(page.len(), 25);
    assert_eq!(next, Some(25));
}

/// Records CPU/memory cost of a full-page `list_versions_paged` read so
/// regressions show up as snapshot diffs (see #895).
///
/// Update the snapshot with `UPDATE_SNAPSHOTS=1 cargo test -p orbital-abi-registry
/// list_versions_paged_full_page_cost_snapshot`.
#[test]
fn list_versions_paged_full_page_cost_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let pointer = String::from_str(&env, "https://example.com/spec.json");

    for i in 1..=MAX_PAGE_SIZE {
        let version = version_str(&env, i);
        client.publish(
            &publisher,
            &contract_id,
            &version,
            &hash(&env, i as u8),
            &pointer,
        );
    }

    let (page, next) =
        client.list_versions_paged(&contract_id, &publisher, &0u32, &MAX_PAGE_SIZE);
    assert_eq!(page.len(), MAX_PAGE_SIZE);
    assert_eq!(next, None);

    let budget = env.cost_estimate().budget();
    let actual = std::format!(
        "list_versions_paged full page (limit={MAX_PAGE_SIZE})\n\
         cpu_instructions={}\n\
         memory_bytes={}\n",
        budget.cpu_instruction_cost(),
        budget.memory_bytes_cost(),
    );

    let snapshot_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("snapshots")
        .join("list_versions_paged_full_page.snap");

    if std::env::var("UPDATE_SNAPSHOTS").ok().as_deref() == Some("1") {
        if let Some(parent) = snapshot_path.parent() {
            fs::create_dir_all(parent).expect("create snapshots dir");
        }
        fs::write(&snapshot_path, &actual).expect("write cost snapshot");
        return;
    }

    let expected = fs::read_to_string(&snapshot_path).unwrap_or_else(|err| {
        panic!(
            "missing cost snapshot at {}: {err}\n\
             Run with UPDATE_SNAPSHOTS=1 to create it.\n\nActual:\n{actual}",
            snapshot_path.display()
        )
    });
    assert_eq!(
        actual, expected,
        "resource cost snapshot drifted; re-run with UPDATE_SNAPSHOTS=1 if the change is intentional"
    );
}

#[test]
fn rejects_empty_version_and_pointer() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let spec_hash = hash(&env, 1);
    let empty = String::from_str(&env, "");
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let version = String::from_str(&env, "1.0.0");

    let result = client.try_publish(&publisher, &contract_id, &empty, &spec_hash, &pointer);
    assert_eq!(result, Err(Ok(Error::EmptyVersion)));

    let result = client.try_publish(&publisher, &contract_id, &version, &spec_hash, &empty);
    assert_eq!(result, Err(Ok(Error::EmptyPointer)));
}

#[test]
#[should_panic]
fn publish_requires_publisher_auth() {
    let env = Env::default();
    // Deliberately no mock_all_auths() - publish() must fail without it.
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let pointer = String::from_str(&env, "https://example.com/spec.json");
    let spec_hash = hash(&env, 1);

    client.publish(&publisher, &contract_id, &version, &spec_hash, &pointer);
}


/// The window entries used to get: 30 days of ledgers. Anything published
/// under the old constant was archived roughly a month after its last write.
const OLD_THIRTY_DAY_HORIZON: u32 = 30 * DAY_IN_LEDGERS;

fn ttl(env: &Env, registry: &Address, key: &DataKey) -> u32 {
    env.as_contract(registry, || env.storage().persistent().get_ttl(key))
}

fn publish_one(env: &Env, client: &AbiRegistryClient<'_>, publisher: &Address, contract_id: &Address, version: &String) {
    client.publish(
        publisher,
        contract_id,
        version,
        &hash(env, 1),
        &String::from_str(env, "https://example.com/spec.json"),
    );
}

#[test]
fn bump_amount_does_not_exceed_the_network_max_entry_ttl() {
    // An extend_ttl asking for more than the network's max_entry_ttl is
    // rejected by the host, so a bump above the cap would break publish()
    // on a live network while every test here still passed.
    assert!(BUMP_AMOUNT <= MAX_ENTRY_TTL);
    assert!(BUMP_AMOUNT > OLD_THIRTY_DAY_HORIZON);
}

#[test]
fn published_entries_outlive_the_old_thirty_day_horizon() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let registry = client.address.clone();

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    publish_one(&env, &client, &publisher, &contract_id, &version);

    let spec_key = DataKey::Spec(contract_id.clone(), publisher.clone(), version.clone());
    let versions_key = DataKey::Versions(contract_id.clone(), publisher.clone());
    let latest_key = DataKey::Latest(contract_id.clone(), publisher.clone());

    for key in [&spec_key, &versions_key, &latest_key] {
        let live = ttl(&env, &registry, key);
        assert_eq!(live, BUMP_AMOUNT);
        assert!(live > OLD_THIRTY_DAY_HORIZON);
    }

    // Past the point where the old 30-day bump would have let the entry
    // archive, the record is still readable and still has life left.
    env.ledger().set_sequence_number(OLD_THIRTY_DAY_HORIZON + DAY_IN_LEDGERS);
    let record = client.latest(&contract_id, &publisher).unwrap();
    assert_eq!(record.version, version);
    assert!(ttl(&env, &registry, &spec_key) > 0);
}

#[test]
fn touch_reextends_entries_that_are_close_to_expiring() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let registry = client.address.clone();

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    publish_one(&env, &client, &publisher, &contract_id, &version);

    // Far enough in that the entries are inside LIFETIME_THRESHOLD, i.e. the
    // point a keeper is expected to run.
    let near_expiry = BUMP_AMOUNT - DAY_IN_LEDGERS;
    env.ledger().set_sequence_number(near_expiry);

    let spec_key = DataKey::Spec(contract_id.clone(), publisher.clone(), version.clone());
    assert_eq!(ttl(&env, &registry, &spec_key), DAY_IN_LEDGERS);

    let mut versions: Vec<String> = Vec::new(&env);
    versions.push_back(version.clone());
    let extended = client.touch(&contract_id, &publisher, &versions);

    // Spec + Versions + Latest.
    assert_eq!(extended, 3);
    assert_eq!(ttl(&env, &registry, &spec_key), BUMP_AMOUNT);
    assert_eq!(
        ttl(&env, &registry, &DataKey::Latest(contract_id.clone(), publisher.clone())),
        BUMP_AMOUNT
    );
    assert_eq!(
        ttl(&env, &registry, &DataKey::Versions(contract_id, publisher)),
        BUMP_AMOUNT
    );
}

#[test]
fn touch_skips_versions_that_were_never_published() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    publish_one(&env, &client, &publisher, &contract_id, &version);

    let mut versions: Vec<String> = Vec::new(&env);
    versions.push_back(version);
    versions.push_back(String::from_str(&env, "9.9.9"));

    // Index pair + the one real spec; the unknown version is not counted.
    assert_eq!(client.touch(&contract_id, &publisher, &versions), 3);
}

#[test]
fn touch_reports_nothing_to_touch_instead_of_silently_succeeding() {
    let env = Env::default();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let versions: Vec<String> = Vec::new(&env);

    assert_eq!(
        client.try_touch(&contract_id, &publisher, &versions),
        Err(Ok(Error::NothingToTouch))
    );
}

#[test]
fn touch_rejects_more_versions_than_a_page() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let publisher = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    publish_one(&env, &client, &publisher, &contract_id, &version);

    let mut versions: Vec<String> = Vec::new(&env);
    for i in 1..=(MAX_PAGE_SIZE + 1) {
        versions.push_back(version_str(&env, i.min(30)));
    }

    assert_eq!(
        client.try_touch(&contract_id, &publisher, &versions),
        Err(Ok(Error::TooManyVersions))
    );
}

fn vec_str(env: &Env, vals: &[&str]) -> soroban_sdk::Vec<String> {
    let mut v = soroban_sdk::Vec::new(env);
    for s in vals {
        v.push_back(String::from_str(env, s));
    }
    v
}

#[test]
fn operator_register_then_get_and_latest() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let operator = Address::generate(&env);
    let v1 = String::from_str(&env, "1.0.0");
    let v2 = String::from_str(&env, "2.0.0");
    let display_name = String::from_str(&env, "Acme Operators");
    let contact = String::from_str(&env, "https://acme.example.com");
    let trigger_classes = vec_str(&env, &["cron", "event"]);
    let networks = vec_str(&env, &["testnet"]);
    let denomination = String::from_str(&env, "XLM");
    let latency_tier = String::from_str(&env, "standard");
    let pointer = String::from_str(&env, "https://acme.example.com/operator.json");

    client.register_operator(
        &operator,
        &v1,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &100i128,
        &denomination,
        &latency_tier,
        &pointer,
    );

    let latest = client.latest_operator(&operator).unwrap();
    assert_eq!(latest.version, v1);
    assert_eq!(latest.display_name, display_name);
    assert_eq!(latest.operator, operator);

    // publish second version
    client.register_operator(
        &operator,
        &v2,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &200i128,
        &denomination,
        &latency_tier,
        &pointer,
    );

    // version lookup returns correct version
    let fetched_v1 = client.get_operator(&operator, &v1).unwrap();
    assert_eq!(fetched_v1.version, v1);
    assert_eq!(fetched_v1.price, 100i128);

    let fetched_v2 = client.get_operator(&operator, &v2).unwrap();
    assert_eq!(fetched_v2.version, v2);
    assert_eq!(fetched_v2.price, 200i128);

    // latest tracks most recent
    let latest = client.latest_operator(&operator).unwrap();
    assert_eq!(latest.version, v2);

    // per-version lookup list
    let versions = client.list_operator_versions(&operator);
    assert_eq!(versions.len(), 2);
    assert_eq!(versions.get(0).unwrap(), v1);
    assert_eq!(versions.get(1).unwrap(), v2);

    // paged
    let (page, next) = client.list_operator_versions_paged(&operator, &0u32, &1u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), v1);
    assert_eq!(next, Some(1));
}

#[test]
fn operator_reregistration_same_version_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let operator = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let display_name = String::from_str(&env, "Acme");
    let contact = String::from_str(&env, "https://acme.example.com");
    let trigger_classes = vec_str(&env, &["cron"]);
    let networks = vec_str(&env, &["testnet"]);
    let denomination = String::from_str(&env, "XLM");
    let latency_tier = String::from_str(&env, "standard");
    let pointer = String::from_str(&env, "https://acme.example.com/o.json");

    client.register_operator(
        &operator,
        &version,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &100i128,
        &denomination,
        &latency_tier,
        &pointer,
    );
    let res = client.try_register_operator(
        &operator,
        &version,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &100i128,
        &denomination,
        &latency_tier,
        &pointer,
    );
    assert_eq!(res, Err(Ok(Error::AlreadyPublished)));
}

#[test]
#[should_panic]
fn operator_publish_requires_operator_auth() {
    let env = Env::default();
    // no mock_all_auths
    let client = setup(&env);
    let operator = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let display_name = String::from_str(&env, "Acme");
    let contact = String::from_str(&env, "https://acme.example.com");
    let trigger_classes = vec_str(&env, &["cron"]);
    let networks = vec_str(&env, &["testnet"]);
    let denomination = String::from_str(&env, "XLM");
    let latency_tier = String::from_str(&env, "standard");
    let pointer = String::from_str(&env, "https://acme.example.com/o.json");
    client.register_operator(
        &operator,
        &version,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &100i128,
        &denomination,
        &latency_tier,
        &pointer,
    );
}

#[test]
fn offering_version_lookup_and_latest() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let operator = Address::generate(&env);
    let target = Address::generate(&env);
    let v1 = String::from_str(&env, "1.0.0");
    let v2 = String::from_str(&env, "2.0.0");
    let function = String::from_str(&env, "ping");
    let trigger_class = String::from_str(&env, "cron");
    let denomination = String::from_str(&env, "XLM");
    let pointer = String::from_str(&env, "https://acme.example.com/offering.json");

    client.register_offering(
        &operator,
        &v1,
        &target,
        &function,
        &trigger_class,
        &50i128,
        &denomination,
        &pointer,
    );
    client.register_offering(
        &operator,
        &v2,
        &target,
        &function,
        &trigger_class,
        &60i128,
        &denomination,
        &pointer,
    );

    let fetched = client.get_offering(&operator, &v1).unwrap();
    assert_eq!(fetched.version, v1);
    assert_eq!(fetched.price, 50i128);
    assert_eq!(fetched.target_contract, target);

    let latest = client.latest_offering(&operator).unwrap();
    assert_eq!(latest.version, v2);
    assert_eq!(latest.price, 60i128);

    let versions = client.list_offering_versions(&operator);
    assert_eq!(versions.len(), 2);
    assert_eq!(versions.get(0).unwrap(), v1);
    assert_eq!(versions.get(1).unwrap(), v2);

    let (page, next) = client.list_offering_versions_paged(&operator, &1u32, &1u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), v2);
    assert_eq!(next, None);
}

#[test]
fn offering_reregistration_same_version_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let operator = Address::generate(&env);
    let target = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let function = String::from_str(&env, "ping");
    let trigger_class = String::from_str(&env, "cron");
    let denomination = String::from_str(&env, "XLM");
    let pointer = String::from_str(&env, "https://acme.example.com/off.json");

    client.register_offering(
        &operator,
        &version,
        &target,
        &function,
        &trigger_class,
        &50i128,
        &denomination,
        &pointer,
    );
    let res = client.try_register_offering(
        &operator,
        &version,
        &target,
        &function,
        &trigger_class,
        &50i128,
        &denomination,
        &pointer,
    );
    assert_eq!(res, Err(Ok(Error::AlreadyPublished)));
}

#[test]
#[should_panic]
fn offering_publish_requires_operator_auth() {
    let env = Env::default();
    let client = setup(&env);
    let operator = Address::generate(&env);
    let target = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let function = String::from_str(&env, "ping");
    let trigger_class = String::from_str(&env, "cron");
    let denomination = String::from_str(&env, "XLM");
    let pointer = String::from_str(&env, "https://acme.example.com/off.json");
    client.register_offering(
        &operator,
        &version,
        &target,
        &function,
        &trigger_class,
        &50i128,
        &denomination,
        &pointer,
    );
}

#[test]
fn only_operator_can_modify_own_record() {
    // Ensures that operator A cannot overwrite operator B's record via
    // publisher auth - the contract requires `operator.require_auth()` so the
    // transaction must be signed by the operator address being written.
    // In tests, mock_all_auths bypasses auth, so we verify isolation by
    // checking that each operator's namespace is independent and that an
    // operator's version list does not leak into another's.
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    let operator_a = Address::generate(&env);
    let operator_b = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let display_name = String::from_str(&env, "Acme");
    let contact = String::from_str(&env, "https://acme.example.com");
    let trigger_classes = vec_str(&env, &["cron"]);
    let networks = vec_str(&env, &["testnet"]);
    let denomination = String::from_str(&env, "XLM");
    let latency_tier = String::from_str(&env, "standard");
    let pointer = String::from_str(&env, "https://acme.example.com/o.json");

    client.register_operator(
        &operator_a,
        &version,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &100i128,
        &denomination,
        &latency_tier,
        &pointer,
    );
    // B has no records yet
    assert!(client.latest_operator(&operator_b).is_none());
    assert_eq!(client.list_operator_versions(&operator_b).len(), 0);

    // B can register its own version independently
    client.register_operator(
        &operator_b,
        &version,
        &display_name,
        &contact,
        &trigger_classes,
        &networks,
        &200i128,
        &denomination,
        &latency_tier,
        &pointer,
    );
    assert_eq!(client.get_operator(&operator_a, &version).unwrap().price, 100i128);
    assert_eq!(client.get_operator(&operator_b, &version).unwrap().price, 200i128);
}
