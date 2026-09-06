/**
 * Orbital's canonical on-chain ABI registry contract ID on testnet, and the
 * publisher address specs are published under. Populated once the registry
 * contract (contracts/registry) is deployed - see
 * contracts/deploy/deploy_testnet.sh and the resulting
 * contracts/deployed.testnet.json.
 *
 * Deployed and seeded 2026-09-06 with the four bundled well-known specs
 * (issue #890). Keep these in step with `contracts/deployed.testnet.json`:
 * a redeploy produces a new contract ID, and leaving a stale one here makes
 * every on-chain resolution silently fall through to the bundled specs
 * instead of failing loudly.
 *
 * While unset, {@link createDefaultAbiRegistryClient}'s resolution chain
 * skips the on-chain link entirely and resolves only the bundled specs.
 */
export const ORBITAL_REGISTRY_TESTNET_CONTRACT_ID =
  "CDJGK3KJMLQK6EVGOMIOQT35IFT2BTDVWC4ICEAXR7WBFTDGOP7FGXCV";

/** The publisher address Orbital's own well-known specs are filed under, once seeded. */
export const ORBITAL_REGISTRY_PUBLISHER_ADDRESS =
  "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG";

export const ORBITAL_REGISTRY_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Testnet's network passphrase, as a literal.
 *
 * Deliberately not `Networks.TESTNET` from `@stellar/stellar-sdk`. This value
 * is read while assembling the *default* registry chain, which runs inside
 * `new EventEngine()` - so importing it from the SDK made constructing an
 * engine depend on the SDK's `Networks` export being present. Any consumer
 * that mocks or partially bundles `@stellar/stellar-sdk` then fails at
 * construction with an error pointing at the registry, far from the cause.
 * pulse-core's own tests mock the SDK with just `Horizon` and hit exactly
 * that.
 *
 * The passphrase is a protocol constant that has not changed since 2015, so a
 * literal costs nothing and removes a load-bearing import from a hot path.
 */
export const ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Base URL of Orbital's hosted ABI registry service. When populated,
 * {@link createDefaultAbiRegistryClient} inserts a
 * {@link HostedAbiRegistryClient} ahead of the on-chain link in the default
 * resolution chain. Empty until the hosted service is live; the chain skips
 * this link entirely while this is unset.
 */
export const ORBITAL_HOSTED_REGISTRY_BASE_URL = "";
