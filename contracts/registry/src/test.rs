#![cfg(test)]

use super::{AbiRegistry, AbiRegistryClient, Error};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String};

fn setup(env: &Env) -> AbiRegistryClient<'_> {
    let contract_id = env.register(AbiRegistry, ());
    AbiRegistryClient::new(env, &contract_id)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
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
        let version = String::from_str(&env, &format!("{}.0.0", i));
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    let (versions, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &limit);
    assert_eq!(versions.len(), limit as usize);
    assert_eq!(next, None); // exactly limit = no more pages

    // Verify order: oldest first
    assert_eq!(versions.get(0).unwrap(), String::from_str(&env, "1.0.0"));
    assert_eq!(
        versions.get((limit - 1) as usize).unwrap(),
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
        let version = String::from_str(&env, &format!("{}.0.0", i));
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    let (page1, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &limit);
    assert_eq!(page1.len(), limit as usize);
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
        let version = String::from_str(&env, &format!("{}.0.0", i));
        client.publish(&publisher, &contract_id, &version, &hash(&env, i as u8), &pointer);
    }

    // Request 100, but should be capped at MAX_PAGE_SIZE (25)
    let (page, next) = client.list_versions_paged(&contract_id, &publisher, &0u32, &100u32);
    assert_eq!(page.len(), 25);
    assert_eq!(next, Some(25));
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
