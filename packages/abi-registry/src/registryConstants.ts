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
 * Base URL of Orbital's hosted ABI registry service. When populated,
 * {@link createDefaultAbiRegistryClient} inserts a
 * {@link HostedAbiRegistryClient} ahead of the on-chain link in the default
 * resolution chain. Empty until the hosted service is live; the chain skips
 * this link entirely while this is unset.
 */
export const ORBITAL_HOSTED_REGISTRY_BASE_URL = "";
