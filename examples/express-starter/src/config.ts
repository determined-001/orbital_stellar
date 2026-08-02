import {
  FileCursorStore,
  PostgresCursorStore,
  type CursorStoreLike,
} from "@orbital-stellar/pulse-core";
import type { Network } from "@orbital-stellar/pulse-core";

/**
 * Runtime configuration, read once at startup.
 *
 * Everything has a default that works with no setup, so `pnpm dev` runs
 * against testnet with a file-backed cursor. Point `DATABASE_URL` at the
 * `docker compose` Postgres to get the production composition.
 */
export type StarterConfig = {
  network: Network;
  /** Stellar accounts to watch. */
  addresses: string[];
  /** Where signed webhooks are delivered. */
  webhookUrl: string;
  /** HMAC secret shared with the receiver. */
  webhookSecret: string;
  /** Port for the local receiver + health endpoints. */
  port: number;
  /** Postgres connection string; when unset the cursor is file-backed. */
  databaseUrl: string | undefined;
  /** Path used by the file-backed cursor store. */
  cursorFile: string;
};

export class MissingConfigError extends Error {
  constructor(name: string, hint: string) {
    super(`${name} is required. ${hint}`);
    this.name = "MissingConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StarterConfig {
  const addresses = (env.STELLAR_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (addresses.length === 0) {
    throw new MissingConfigError(
      "STELLAR_ADDRESSES",
      "Set it to a comma-separated list of Stellar account IDs to watch.",
    );
  }

  const webhookSecret = env.WEBHOOK_SECRET ?? "";
  if (webhookSecret.length < 16) {
    throw new MissingConfigError(
      "WEBHOOK_SECRET",
      "Set it to at least 16 characters - `openssl rand -hex 32` is a good source.",
    );
  }

  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new MissingConfigError("PORT", `Expected a positive integer, received "${env.PORT}".`);
  }

  return {
    network: env.STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet",
    addresses,
    webhookUrl: env.WEBHOOK_URL ?? `http://127.0.0.1:${port}/hooks/stellar`,
    webhookSecret,
    port,
    databaseUrl: env.DATABASE_URL,
    cursorFile: env.CURSOR_FILE ?? ".orbital-cursor.json",
  };
}

/**
 * Postgres when `DATABASE_URL` is set, a file otherwise.
 *
 * The file store is not a toy: it survives a restart, which is what the
 * resume guarantee needs. Postgres is what you want when more than one
 * instance shares the cursor.
 */
export async function createCursorStore(
  config: StarterConfig,
): Promise<{ store: CursorStoreLike; close: () => Promise<void>; kind: "postgres" | "file" }> {
  if (!config.databaseUrl) {
    return {
      store: new FileCursorStore(config.cursorFile),
      close: async () => {},
      kind: "file",
    };
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cursor_store (
      stream_key TEXT PRIMARY KEY,
      cursor TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  return {
    store: new PostgresCursorStore(pool),
    close: () => pool.end(),
    kind: "postgres",
  };
}
