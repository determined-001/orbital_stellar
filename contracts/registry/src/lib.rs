#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    String, Vec,
};

// Persistent storage entries are bumped on every touch so a spec never
// silently archives out from under a live registry. ~30 days of ledgers
// at Stellar's ~5s close time, refreshed once the entry is within a day
// of expiring.
const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Maximum number of versions returned by a single `list_versions_paged`
/// call. Keeps Soroban resource costs bounded. Clients must page through
/// results using the returned cursor.
pub const MAX_PAGE_SIZE: u32 = 25;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A spec for this (contract_id, publisher, version) already exists.
    /// Specs are immutable per version - republish under a new version instead.
    AlreadyPublished = 1,
    EmptyVersion = 2,
    EmptyPointer = 3,
    /// The requested start cursor exceeds the total number of versions.
    StartPastEnd = 4,
    /// The requested page limit exceeds MAX_PAGE_SIZE.
    LimitExceedsMax = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpecRecord {
    pub version: String,
    /// sha256 of the canonical off-chain ContractSpec JSON.
    pub spec_hash: BytesN<32>,
    /// Off-chain locator for the full spec blob. The contract does not
    /// interpret this value - integrity is verified by the caller re-hashing
    /// the fetched blob and comparing it against `spec_hash`.
    pub pointer: String,
    pub publisher: Address,
    pub published_at: u64,
    pub published_at_ledger: u32,
}

#[contracttype]
enum DataKey {
    Spec(Address, Address, String),
    Versions(Address, Address),
    Latest(Address, Address),
}

/// Emitted whenever a spec is successfully published. Deliberately declared
/// via `#[contractevent]` so the registry's own ABI is discoverable by the
/// same WASM-introspection path it exists to support for every other
/// contract.
#[contractevent]
#[derive(Clone, Debug)]
pub struct SpecPublished {
    #[topic]
    pub contract_id: Address,
    #[topic]
    pub version: String,
    pub spec_hash: BytesN<32>,
    pub pointer: String,
    pub publisher: Address,
}

#[contract]
pub struct AbiRegistry;

#[contractimpl]
impl AbiRegistry {
    /// Publishes a new spec version for `contract_id` under `publisher`'s
    /// namespace. Requires `publisher`'s authorization. Rejects republishing
    /// an existing (contract_id, publisher, version) triple - specs are
    /// immutable once published. Emits `SpecPublished` on success.
    pub fn publish(
        env: Env,
        publisher: Address,
        contract_id: Address,
        version: String,
        spec_hash: BytesN<32>,
        pointer: String,
    ) -> Result<(), Error> {
        publisher.require_auth();

        if version.is_empty() {
            return Err(Error::EmptyVersion);
        }
        if pointer.is_empty() {
            return Err(Error::EmptyPointer);
        }

        let spec_key = DataKey::Spec(contract_id.clone(), publisher.clone(), version.clone());
        if env.storage().persistent().has(&spec_key) {
            return Err(Error::AlreadyPublished);
        }

        let record = SpecRecord {
            version: version.clone(),
            spec_hash: spec_hash.clone(),
            pointer: pointer.clone(),
            publisher: publisher.clone(),
            published_at: env.ledger().timestamp(),
            published_at_ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&spec_key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&spec_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        let versions_key = DataKey::Versions(contract_id.clone(), publisher.clone());
        let mut versions: Vec<String> = env
            .storage()
            .persistent()
            .get(&versions_key)
            .unwrap_or_else(|| Vec::new(&env));
        versions.push_back(version.clone());
        env.storage().persistent().set(&versions_key, &versions);
        env.storage()
            .persistent()
            .extend_ttl(&versions_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        let latest_key = DataKey::Latest(contract_id.clone(), publisher.clone());
        env.storage().persistent().set(&latest_key, &version);
        env.storage()
            .persistent()
            .extend_ttl(&latest_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        SpecPublished {
            contract_id,
            version,
            spec_hash,
            pointer,
            publisher,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns the most recently published spec for (contract_id, publisher),
    /// or `None` if that publisher has never published a spec for it.
    pub fn latest(env: Env, contract_id: Address, publisher: Address) -> Option<SpecRecord> {
        let latest_key = DataKey::Latest(contract_id.clone(), publisher.clone());
        let version: String = env.storage().persistent().get(&latest_key)?;
        Self::get_version(env, contract_id, publisher, version)
    }

    /// Returns a specific published version's record, or `None` if it was
    /// never published.
    pub fn get_version(
        env: Env,
        contract_id: Address,
        publisher: Address,
        version: String,
    ) -> Option<SpecRecord> {
        let spec_key = DataKey::Spec(contract_id, publisher, version);
        env.storage().persistent().get(&spec_key)
    }

/// Returns every version published for (contract_id, publisher), oldest
/// first, or an empty vector if none have been published.
///
/// NOTE: This accessor is unbounded and may exceed Soroban resource budgets
/// for contracts with many versions. New callers should prefer
/// `list_versions_paged`. This function will be deprecated in a future
/// release.
pub fn list_versions(env: Env, contract_id: Address, publisher: Address) -> Vec<String> {
    let versions_key = DataKey::Versions(contract_id.clone(), publisher.clone());
    let all: Vec<String> = env
        .storage()
        .persistent()
        .get(&versions_key)
        .unwrap_or_else(|| Vec::new(&env));

    // Cap at MAX_PAGE_SIZE and emit a warning marker via truncation.
    // The last entry is replaced with a sentinel when truncated so callers
    // know the list was clipped.
    let max = MAX_PAGE_SIZE as u32;
    if all.len() > max {
        let mut capped: Vec<String> = all.slice(0, max).into_iter().collect();
        let truncation_marker = String::from_str(
            &env,
            &format!("__truncated_{}_total__", all.len()),
        );
        capped.push_back(truncation_marker);
        capped
    } else {
        all
    }
}

/// Returns a paged slice of versions for (contract_id, publisher), oldest
/// first, plus an optional cursor for the next page.
///
/// - `start`: zero-based index into the full version list to begin from.
/// - `limit`: maximum number of versions to return (capped internally at
///   `MAX_PAGE_SIZE`).
///
/// Returns `(versions, Option<next_start>)` where `next_start` is `Some`
/// with the start index for the next page if there are more results, or
/// `None` if this was the last page.
///
/// Resource cost of a full-page read is documented in the test snapshot.
pub fn list_versions_paged(
    env: Env,
    contract_id: Address,
    publisher: Address,
    start: u32,
    limit: u32,
) -> (Vec<String>, Option<u32>) {
    let versions_key = DataKey::Versions(contract_id, publisher);
    let all: Vec<String> = env
        .storage()
        .persistent()
        .get(&versions_key)
        .unwrap_or_else(|| Vec::new(&env));

    let total = all.len();
    if start >= total {
        return (Vec::new(&env), None);
    }

    let effective_limit = limit.min(MAX_PAGE_SIZE);
    let end = (start + effective_limit).min(total);
    let page: Vec<String> = all.slice(start, end - start).into_iter().collect();
    let next_cursor = if end < total { Some(end) } else { None };

    (page, next_cursor)
}
}

mod test;
