#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    String, Vec,
};

// ~5s ledger close time, so 17_280 ledgers is about a day.
const DAY_IN_LEDGERS: u32 = 17_280;

/// The network's `max_entry_ttl` state-archival setting, in ledgers: the
/// longest live-until window a single `extend_ttl` may ask for. Asking for
/// more than the network allows makes the host reject the extension, so this
/// must never exceed the live value.
///
/// 3_110_400 ledgers is ~180 days at a 5s close time. Verified against both
/// networks on 2026-08-31 by reading the `STATE_ARCHIVAL` config setting
/// (`ConfigSettingId` 10) over Soroban RPC:
///
/// ```text
/// curl -s -X POST https://soroban-testnet.stellar.org \
///   -H 'Content-Type: application/json' \
///   -d '{"jsonrpc":"2.0","id":1,"method":"getLedgerEntries",
///        "params":{"keys":["AAAACAAAAAo="]}}'
/// # testnet max_entry_ttl = 3_110_400, pubnet max_entry_ttl = 3_110_400
/// ```
///
/// Re-check this before raising it; the setting is a validator-votable
/// network parameter, not a protocol constant.
const MAX_ENTRY_TTL: u32 = 3_110_400;

/// Every write extends the entries it touches to the network maximum rather
/// than the old ~30-day window. A spec published once and never republished
/// used to archive about a month later, which made the registry's canonical
/// record evaporate monthly and pushed the `RestoreFootprint` cost onto a
/// downstream consumer who did nothing wrong. Read paths deliberately do not
/// extend anything (see `latest`), so `touch` is the supported way to keep an
/// entry alive past this window.
const BUMP_AMOUNT: u32 = MAX_ENTRY_TTL;

/// Re-extend once an entry is within 30 days of expiring. Below the bump
/// itself so a `touch` that runs early is a cheap no-op rather than paying
/// rent on every call.
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - 30 * DAY_IN_LEDGERS;

/// Maximum number of versions returned by a single `list_versions_paged`
/// call. Keeps Soroban resource costs bounded. Clients must page through
/// results using the returned cursor.
pub const MAX_PAGE_SIZE: u32 = 25;

/// Appended as the final entry by the unpaged `list_versions` accessor when
/// the full set exceeded `MAX_PAGE_SIZE`, so callers can detect clipping
/// instead of silently receiving a short list.
pub const TRUNCATION_MARKER: &str = "__truncated__";

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
    /// `touch` was handed more versions than `MAX_PAGE_SIZE`, which would
    /// make its footprint unbounded.
    TooManyVersions = 6,
    /// `touch` found no live entry for the given (contract_id, publisher):
    /// nothing was ever published under it, or every entry has already been
    /// archived and needs a `RestoreFootprint` before it can be extended.
    NothingToTouch = 7,
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
    ///
    /// Deliberately does NOT extend the TTL of the entries it reads. Every
    /// resolver in this repo reads the registry through `simulateTransaction`
    /// with an unfunded throwaway source (see
    /// `packages/abi-registry/src/OnChainAbiRegistryClient.ts`); a read that
    /// wrote would turn spec resolution into a fee-paying, signed transaction
    /// for every consumer. Durability comes from the write path bumping to
    /// `MAX_ENTRY_TTL` and from `touch` being run on a schedule instead.
    pub fn latest(env: Env, contract_id: Address, publisher: Address) -> Option<SpecRecord> {
        let latest_key = DataKey::Latest(contract_id.clone(), publisher.clone());
        let version: String = env.storage().persistent().get(&latest_key)?;
        Self::get_version(env, contract_id, publisher, version)
    }

    /// Returns a specific published version's record, or `None` if it was
    /// never published.
    ///
    /// `None` means "never published". An entry that was published and has
    /// since been archived does not reach this function at all - the host
    /// rejects the invocation before it runs and the RPC answers with a
    /// restore preamble, which is what lets clients tell the two apart.
    /// Read-only for the same reason as `latest`.
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
    let max = MAX_PAGE_SIZE;
    if all.len() > max {
        // `slice` takes a range and already returns a Vec; soroban_sdk::Vec
        // does not implement FromIterator, so no collect() here.
        let mut capped: Vec<String> = all.slice(0..max);
        // The contract is #![no_std] with no alloc, so the marker cannot
        // interpolate the total. Callers needing the count use
        // `list_versions_paged`, whose cursor walks the full set.
        capped.push_back(String::from_str(&env, TRUNCATION_MARKER));
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
    let page: Vec<String> = all.slice(start..end);
    let next_cursor = if end < total { Some(end) } else { None };

    (page, next_cursor)
}

/// Keeper entrypoint: extends the TTL of the entries backing
/// (contract_id, publisher) back out to `MAX_ENTRY_TTL`.
///
/// Reads are pure by design, so this is the path that keeps a spec alive
/// after publication. It is permissionless - TTL extension only ever adds
/// life to an entry, so anyone willing to pay the rent may call it, which
/// means a keeper needs a funded key but no privileged one.
///
/// Extends the `Latest` and `Versions` index entries, plus the `Spec` entry
/// for each version in `versions`. Pass the versions returned by
/// `list_versions_paged`; a caller with more than `MAX_PAGE_SIZE` versions
/// pages through them across several calls, which keeps each call's
/// footprint bounded.
///
/// Returns the number of entries extended. Errors with `NothingToTouch` when
/// no live entry exists for the pair, so a keeper can tell "nothing here" from
/// "kept alive" instead of silently succeeding.
pub fn touch(
    env: Env,
    contract_id: Address,
    publisher: Address,
    versions: Vec<String>,
) -> Result<u32, Error> {
    if versions.len() > MAX_PAGE_SIZE {
        return Err(Error::TooManyVersions);
    }

    let mut extended: u32 = 0;

    let latest_key = DataKey::Latest(contract_id.clone(), publisher.clone());
    if env.storage().persistent().has(&latest_key) {
        env.storage()
            .persistent()
            .extend_ttl(&latest_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        extended += 1;
    }

    let versions_key = DataKey::Versions(contract_id.clone(), publisher.clone());
    if env.storage().persistent().has(&versions_key) {
        env.storage()
            .persistent()
            .extend_ttl(&versions_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        extended += 1;
    }

    for version in versions.iter() {
        let spec_key = DataKey::Spec(contract_id.clone(), publisher.clone(), version);
        if env.storage().persistent().has(&spec_key) {
            env.storage()
                .persistent()
                .extend_ttl(&spec_key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
            extended += 1;
        }
    }

    if extended == 0 {
        return Err(Error::NothingToTouch);
    }

    Ok(extended)
}
}

mod test;
