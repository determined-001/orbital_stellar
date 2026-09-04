import type { PgLike } from "./PostgresWorkerStateStore.js";

export type FireKey = {
  workerId: string;
  windowStartLedger: number;
};

export function fireKeyToString(k: FireKey): string {
  return `${k.workerId}:${k.windowStartLedger}`;
}

export interface ClaimRecord {
  owner: string;
  expiresAt: number; // epoch ms
}

export interface ClaimStore {
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<ClaimRecord | null>;
  release(key: string, owner?: string): Promise<void>;
}

/** Simple in-memory claim store for tests and single-process usage. */
export class InMemoryClaimStore implements ClaimStore {
  private map = new Map<string, ClaimRecord>();

  async claim(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.map.get(key);
    if (existing) {
      if (existing.expiresAt <= now) {
        // expired - take over
        this.map.set(key, { owner, expiresAt: now + ttlMs });
        return true;
      }
      return false;
    }
    this.map.set(key, { owner, expiresAt: now + ttlMs });
    return true;
  }

  async get(key: string): Promise<ClaimRecord | null> {
    const now = Date.now();
    const r = this.map.get(key) ?? null;
    if (r && r.expiresAt <= now) return null;
    return r;
  }

  async release(key: string, owner?: string): Promise<void> {
    const existing = this.map.get(key);
    if (existing && (owner === undefined || existing.owner === owner)) {
      this.map.delete(key);
    }
  }
}

/** PostgreSQL-backed claims shared by worker processes and restarts. */
export class PostgresClaimStore implements ClaimStore {
  constructor(private readonly pg: PgLike) {}

  async claim(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const result = await this.pg.query(
      `INSERT INTO worker_fire_claims (fire_key, owner, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
       ON CONFLICT (fire_key) DO UPDATE
       SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
       WHERE worker_fire_claims.expires_at <= NOW()
       RETURNING fire_key`,
      [key, owner, ttlMs],
    );
    return result.rows.length > 0;
  }

  async get(key: string): Promise<ClaimRecord | null> {
    const result = await this.pg.query(
      `SELECT owner, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_at
       FROM worker_fire_claims
       WHERE fire_key = $1 AND expires_at > NOW()`,
      [key],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      owner: row.owner as string,
      expiresAt: Number(row.expires_at),
    };
  }

  async release(key: string, owner?: string): Promise<void> {
    if (owner === undefined) {
      await this.pg.query("DELETE FROM worker_fire_claims WHERE fire_key = $1", [key]);
      return;
    }
    await this.pg.query("DELETE FROM worker_fire_claims WHERE fire_key = $1 AND owner = $2", [
      key,
      owner,
    ]);
  }
}

/**
 * Manager that claims a fire key before running a submission.
 *
 * - The default `claimTtlMs` is five minutes, deliberately exceeding a
 *   worst-case confirmation window with a wide operational margin.
 * - `chainCheck` is called to see whether submission already reached chain
 *   and should be checked before re-submitting after a restart.
 */
export class IdempotencyManager {
  constructor(
    private readonly store: ClaimStore,
    private readonly chainCheck: (windowStartLedger: number) => Promise<boolean>,
    private readonly claimTtlMs = 5 * 60_000,
  ) {
    if (!Number.isFinite(claimTtlMs) || claimTtlMs <= 0) {
      throw new Error(`claimTtlMs must be positive, got ${claimTtlMs}`);
    }
  }

  /** Attempt to claim and, if claimed, run `submitFn`. Returns true when a submit happened. */
  async claimThenSubmit(
    key: FireKey,
    ownerId: string,
    submitFn: () => Promise<void>,
  ): Promise<boolean> {
    const ks = fireKeyToString(key);

    const claimed = await this.store.claim(ks, ownerId, this.claimTtlMs);
    if (!claimed) {
      // Someone else holds an unexpired claim; do nothing.
      return false;
    }

    // We hold (or refreshed) the claim. Before submitting, check chain to
    // ensure the target action hasn't already executed (recovery case).
    const executed = await this.chainCheck(key.windowStartLedger);
    if (executed) {
      // nothing to do; release claim
      await this.store.release(ks, ownerId);
      return false;
    }

    // Safe to submit.
    await submitFn();

    // Keep the claim until its TTL covers the lag between submission and chain
    // visibility. The next attempt checks chain state after the claim expires.
    return true;
  }
}
