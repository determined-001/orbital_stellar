import { Networks } from "@stellar/stellar-sdk";
import { BundledWellKnownClient } from "./BundledWellKnownClient.js";
import { ChainedAbiRegistryClient } from "./ChainedAbiRegistryClient.js";
import type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
import { HostedAbiRegistryClient } from "./HostedAbiRegistryClient.js";
import { OnChainAbiRegistryClient } from "./OnChainAbiRegistryClient.js";
import { Sep48EmbeddedClient } from "./discovery/Sep48EmbeddedClient.js";
import {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
  ORBITAL_HOSTED_REGISTRY_BASE_URL,
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

  /**
   * When `true`, the hosted registry link is skipped entirely and the chain
   * resolves specs directly via the on-chain registry (and the bundled
   * well-known set). Use this to opt out of the hosted fast-path while still
   * benefiting from on-chain resolution.
   *
   * Defaults to `false`.
   */
  chainOnly?: boolean;
};

function readEnv(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value?.trim() ? value.trim() : undefined;
}

/**
 * Builds `EventEngine`'s default registry resolution chain.
 *
 * Precedence order (first match wins):
 * 1. **SEP-48 embedded** – `#[contractevent]` entries parsed from the
 *    contract's WASM bytecode (only when `options.rpcUrl` is provided).
 * 2. **Bundled well-known** – offline specs for USDC, EURC, AQUA, native XLM.
 * 3. **Hosted registry** (`/v1/` endpoints) – sub-second latency from the
 *    Orbital-operated registry service. Falls through on timeout, 5xx, or
 *    hash mismatch, so an outage here never blocks resolution. Skipped when
 *    `options.chainOnly` is `true` or when
 *    {@link ORBITAL_HOSTED_REGISTRY_BASE_URL} is empty.
 * 4. **On-chain registry** – Orbital's testnet registry (once deployed and
 *    {@link ORBITAL_REGISTRY_TESTNET_CONTRACT_ID} is populated).
 *
 * Used when `CoreConfig.abiRegistry` is omitted; pass `abiRegistry: false`
 * to opt out of default resolution entirely and preserve pre-default behavior
 * (`decodedData` never populated).
 */
export function createDefaultAbiRegistryClient(
  options?: CreateDefaultAbiRegistryClientOptions,
): ChainedAbiRegistryClient {
  const chainOnly = options?.chainOnly ?? false;
  const clients: AbiRegistryReader[] = [];

  // SEP-48 embedded spec is the canonical source - first in the chain.
  if (options?.rpcUrl) {
    clients.push(new Sep48EmbeddedClient(options.rpcUrl));
  }

  clients.push(new BundledWellKnownClient());

  const registryContractId =
    readEnv("ORBITAL_REGISTRY_TESTNET_CONTRACT_ID") ?? ORBITAL_REGISTRY_TESTNET_CONTRACT_ID;
  const publisherAddress =
    readEnv("ORBITAL_REGISTRY_PUBLISHER_ADDRESS") ?? ORBITAL_REGISTRY_PUBLISHER_ADDRESS;
  const rpcUrl = readEnv("ORBITAL_REGISTRY_TESTNET_RPC_URL") ?? ORBITAL_REGISTRY_TESTNET_RPC_URL;
  const hostedBaseUrl =
    readEnv("ORBITAL_HOSTED_REGISTRY_BASE_URL") ?? ORBITAL_HOSTED_REGISTRY_BASE_URL;

  // Build the on-chain client first so it can be passed to the hosted client
  // for sampled hash verification.
  let onChainClient: OnChainAbiRegistryClient | undefined;
  if (registryContractId) {
    onChainClient = new OnChainAbiRegistryClient({
      contractId: registryContractId,
      rpcUrl,
      networkPassphrase: Networks.TESTNET,
      publisher: publisherAddress,
    });
  }

  // Insert the hosted client ahead of the on-chain client unless opted out.
  if (!chainOnly && hostedBaseUrl) {
    clients.push(
      new HostedAbiRegistryClient({
        baseUrl: hostedBaseUrl,
        onChainClient,
      }),
    );
  }

  if (onChainClient) {
    clients.push(onChainClient);
  }

  return new ChainedAbiRegistryClient(clients);
}
