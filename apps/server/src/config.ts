export const VALID_NETWORKS = ["mainnet", "testnet"] as const;
export type Network = typeof VALID_NETWORKS[number];

export interface ServerConfig {
  NETWORK: Network;
  PORT: number;
  API_KEY: string;
  WEBHOOK_SECRET: string;
}

function parseConfig(): ServerConfig {
  const errors: string[] = [];

  const rawNetwork = process.env.NETWORK;
  if (!rawNetwork || !(VALID_NETWORKS as readonly string[]).includes(rawNetwork)) {
    errors.push(`Invalid or missing NETWORK env var: "${rawNetwork}". Must be "mainnet" or "testnet".`);
  }

  const rawPort = process.env.PORT;
  let port = 3000;
  if (rawPort !== undefined) {
    const parsed = parseInt(rawPort, 10);
    if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
      errors.push(`Invalid PORT env var: "${rawPort}". Must be a valid port number.`);
    } else {
      port = parsed;
    }
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    errors.push(`Missing API_KEY env var.`);
  }

  const webhookSecret = process.env.WEBHOOK_SECRET || "pulse-default-hmac-key";

  if (errors.length > 0) {
    console.error("[server] Environment validation failed:");
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  const config: ServerConfig = {
    NETWORK: rawNetwork as Network,
    PORT: port,
    API_KEY: apiKey as string,
    WEBHOOK_SECRET: webhookSecret,
  };

  console.log("[server] Configuration loaded:");
  console.log(`  NETWORK: ${config.NETWORK}`);
  console.log(`  PORT: ${config.PORT}`);
  console.log(`  API_KEY: ${config.API_KEY ? "***REDACTED***" : "missing"}`);
  console.log(`  WEBHOOK_SECRET: ${process.env.WEBHOOK_SECRET ? "***REDACTED***" : "default"}`);

  return config;
}

export const config = parseConfig();
