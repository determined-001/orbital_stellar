import { Networks } from "@stellar/stellar-sdk";
import { BundledWellKnownClient } from "./BundledWellKnownClient.js";
import { ChainedAbiRegistryClient } from "./ChainedAbiRegistryClient.js";
import type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
import { HostedAbiRegistryClient } from "./HostedAbiRegistryClient.js";
import { OnChainAbiRegistryClient } from "./OnChainAbiRegistryClient.js";
import {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
  ORBITAL_HOSTED_REGISTRY_BASE_URL,
} from "./registryConstants.js";

/**
 * Options for {@link createDefaultAbiRegistryClient}.
 */
export interface CreateDefaultAbiRegistryClientOptions {
  /**
   * When `true`, the hosted registry link is skipped entirely and the chain
   * resolves specs directly via the on-chain registry (and the bundled
   * well-known set). Use this to opt out of the hosted fast-path while still
   * benefiting from on-chain resolution.
   *
   * Defaults to `false`.
   */
  chainOnly?: boolean;
}

/**
 * Builds `EventEngine`'s default registry resolution chain:
 *
 * 1. **Bundled well-known specs** – works fully offline, no network required
 *    (USDC, EURC, AQUA, native XLM wrapper).
 * 2. **Hosted registry** (`/v1/` endpoints) – sub-second latency from the
 *    Orbital-operated registry service. Falls through on timeout, 5xx, or
 *    hash mismatch, so an outage here never blocks resolution. Skipped when
 *    `options.chainOnly` is `true` or when
 *    {@link ORBITAL_HOSTED_REGISTRY_BASE_URL} is empty.
 * 3. **On-chain registry** – reads the deployed Orbital registry contract via
 *    Soroban RPC simulation. Skipped while
 *    {@link ORBITAL_REGISTRY_TESTNET_CONTRACT_ID} is not yet populated.
 *
 * Used when `CoreConfig.abiRegistry` is omitted; pass `abiRegistry: false`
 * to opt out of default resolution entirely and preserve pre-default behavior
 * (`decodedData` never populated).
 */
export function createDefaultAbiRegistryClient(
  options: CreateDefaultAbiRegistryClientOptions = {},
): AbiRegistryReader {
  const { chainOnly = false } = options;

  const clients: AbiRegistryReader[] = [new BundledWellKnownClient()];

  // Build the on-chain client first so it can be passed to the hosted client
  // for sampled hash verification.
  let onChainClient: OnChainAbiRegistryClient | undefined;
  if (ORBITAL_REGISTRY_TESTNET_CONTRACT_ID) {
    onChainClient = new OnChainAbiRegistryClient({
      contractId: ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
      rpcUrl: ORBITAL_REGISTRY_TESTNET_RPC_URL,
      networkPassphrase: Networks.TESTNET,
      publisher: ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
    });
  }

  // Insert the hosted client ahead of the on-chain client unless opted out.
  if (!chainOnly && ORBITAL_HOSTED_REGISTRY_BASE_URL) {
    clients.push(
      new HostedAbiRegistryClient({
        baseUrl: ORBITAL_HOSTED_REGISTRY_BASE_URL,
        onChainClient,
      }),
    );
  }

  if (onChainClient) {
    clients.push(onChainClient);
  }

  return new ChainedAbiRegistryClient(clients);
}
