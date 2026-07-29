import { Networks } from "@stellar/stellar-sdk";
import { BundledWellKnownClient } from "./BundledWellKnownClient.js";
import { ChainedAbiRegistryClient } from "./ChainedAbiRegistryClient.js";
import type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
import { OnChainAbiRegistryClient } from "./OnChainAbiRegistryClient.js";
import { Sep48EmbeddedClient } from "./discovery/Sep48EmbeddedClient.js";
import {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "./registryConstants.js";

/**
 * Options for {@link createDefaultAbiRegistryClient}.
 */
export type CreateDefaultAbiRegistryClientOptions = {
  /**
   * Soroban RPC URL for SEP-48 embedded spec discovery. When provided, a
   * {@link Sep48EmbeddedClient} is inserted as the **first** link in the
   * resolution chain, making embedded `#[contractevent]` specs the canonical
   * source (per ROADMAP Wave 2.2). When omitted the chain starts at the
   * bundled well-known specs, preserving fully-offline behavior.
   */
  rpcUrl?: string;
};

/**
 * Builds `EventEngine`'s default registry resolution chain.
 *
 * Precedence order (first match wins):
 * 1. **SEP-48 embedded** – `#[contractevent]` entries parsed from the
 *    contract's WASM bytecode (only when `options.rpcUrl` is provided).
 * 2. **Bundled well-known** – offline specs for USDC, EURC, AQUA, native XLM.
 * 3. **On-chain registry** – Orbital's testnet registry (once deployed and
 *    {@link ORBITAL_REGISTRY_TESTNET_CONTRACT_ID} is populated).
 *
 * Used when `CoreConfig.abiRegistry` is omitted; pass `abiRegistry: false`
 * to opt out of default resolution entirely and preserve pre-default
 * behavior (`decodedData` never populated).
 */
export function createDefaultAbiRegistryClient(
  options?: CreateDefaultAbiRegistryClientOptions,
): ChainedAbiRegistryClient {
  const clients: AbiRegistryReader[] = [];

  // SEP-48 embedded spec is the canonical source - first in the chain.
  if (options?.rpcUrl) {
    clients.push(new Sep48EmbeddedClient(options.rpcUrl));
  }

  clients.push(new BundledWellKnownClient());

  if (registryContractId) {
    clients.push(
      new OnChainAbiRegistryClient({
        contractId: registryContractId,
        rpcUrl,
        networkPassphrase: Networks.TESTNET,
        publisher: publisherAddress,
      }),
    );
  }

  return new ChainedAbiRegistryClient(clients);
}
