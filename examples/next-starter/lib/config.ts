import { StrKey } from "@orbital-stellar/pulse-core";
import type { Network } from "@orbital-stellar/pulse-core";

/**
 * Environment validation, run at module load on the server.
 *
 * A missing or malformed variable fails startup with a message naming the
 * variable and what it expected. An app that starts and then silently watches
 * nothing is worse than one that refuses to boot.
 */

export class StarterConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`[next-starter] ${variable}: ${problem}`);
    this.name = "StarterConfigError";
  }
}

export type StarterConfig = {
  network: Network;
  /** Accounts offered on the home page. */
  addresses: string[];
  /**
   * Optional Soroban contract to watch, or null when none is configured.
   * Unused by the pages that ship here - see "Extending it" in the README for
   * wiring it to `useContractEvent`.
   */
  contractId: string | null;
  /** Where the file-backed cursor lives. */
  cursorDir: string;
  /** Soroban RPC endpoint for contract event subscription. */
  sorobanRpcUrl: string;
};

const DEFAULT_RPC: Record<Network, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

/**
 * Placeholders written by `contracts/deploy/deploy_testnet.sh` before a real
 * deployment. Treating one as configured would produce a page that looks live
 * and never emits.
 */
export function isPlaceholderContractId(id: string): boolean {
  return id.startsWith("<") || id.includes("POPULATED BY") || id.length < 8;
}

/**
 * `Record<string, string | undefined>` rather than `NodeJS.ProcessEnv`: that is
 * all this function reads, and the narrower type forces every caller - tests
 * included - to supply unrelated required members like `NODE_ENV`.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): StarterConfig {
  const network: Network = env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

  const raw = env.STELLAR_ADDRESSES ?? "";
  const addresses = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (addresses.length === 0) {
    throw new StarterConfigError(
      "STELLAR_ADDRESSES",
      "required - set it to a comma-separated list of Stellar account IDs (see .env.example)",
    );
  }

  const invalid = addresses.filter((address) => !StrKey.isValidEd25519PublicKey(address));
  if (invalid.length > 0) {
    throw new StarterConfigError(
      "STELLAR_ADDRESSES",
      `not a valid Stellar public key: ${invalid.join(", ")}`,
    );
  }

  const contractEnv = env.DEMO_CONTRACT_ID?.trim();
  const contractId = contractEnv && !isPlaceholderContractId(contractEnv) ? contractEnv : null;

  return {
    network,
    addresses,
    contractId,
    cursorDir: env.CURSOR_DIR ?? ".orbital",
    sorobanRpcUrl: env.SOROBAN_RPC_URL ?? DEFAULT_RPC[network],
  };
}
