import type { Network } from "@orbital-stellar/pulse-core";

const VALID: readonly Network[] = ["mainnet", "testnet"] as const;

function isNetwork(v: unknown): v is Network {
  return typeof v === "string" && (VALID as readonly string[]).includes(v);
}

export function getNetwork(): Network {
  const raw = process.env.NEXT_PUBLIC_NETWORK;
  if (!isNetwork(raw)) {
    throw new Error(
      `NEXT_PUBLIC_NETWORK must be "mainnet" or "testnet", got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}
