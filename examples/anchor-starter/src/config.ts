/**
 * Runtime configuration, read once at startup.
 *
 * Only `STELLAR_SECRET` has no usable default - everything else works out of
 * the box against Stellar Development Foundation's own reference anchor on
 * testnet (verified live: SEP-1/10/24/31 all reachable at homeDomain).
 */

export type StarterConfig = {
  /** Anchor home domain SEP-1 discovery reads `stellar.toml` from. */
  homeDomain: string;
  /** The Stellar account authenticating and (for deposit) receiving funds. */
  secret: string;
  /** testnet (default) or mainnet - only testnet is exercised by this starter. */
  network: "testnet" | "mainnet";
  /** Asset code to deposit/send. Defaults to SRT, the anchor's own test asset. */
  assetCode: string;
};

export class MissingConfigError extends Error {
  constructor(name: string, hint: string) {
    super(`${name} is required. ${hint}`);
    this.name = "MissingConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StarterConfig {
  const secret = env.STELLAR_SECRET ?? "";
  if (!secret.startsWith("S") || secret.length !== 56) {
    throw new MissingConfigError(
      "STELLAR_SECRET",
      "Set it to a funded testnet account's secret key (S...). `stellar keys generate` + Friendbot will fund one.",
    );
  }

  return {
    homeDomain: env.HOME_DOMAIN ?? "testanchor.stellar.org",
    secret,
    network: env.STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet",
    assetCode: env.ASSET_CODE ?? "SRT",
  };
}
