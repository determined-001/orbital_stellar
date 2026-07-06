import { EventEngine, type Network } from "@orbital-stellar/pulse-core";
import { getNetwork } from "./network";

const g = globalThis as unknown as { __orbitalEngine?: EventEngine };

const SOROBAN_RPC_URLS: Record<Network, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

export function getEngine(): EventEngine {
  if (!g.__orbitalEngine) {
    const network = getNetwork();
    const engine = new EventEngine({
      network,
      soroban: { rpcUrl: SOROBAN_RPC_URLS[network] },
    });
    engine.start();
    g.__orbitalEngine = engine;
  }
  return g.__orbitalEngine;
}
