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
  // For tests and cleanup
  release(key: string): Promise<void>;
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
      if (existing.owner === owner) {
        // same owner may re-claim / refresh
        existing.expiresAt = now + ttlMs;
        this.map.set(key, existing);
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

  async release(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Manager that claims a fire key before running a submission.
 *
 * - `claimTtlMs` should exceed the worst-case confirmation time.
 * - `chainCheck` is called to see whether submission already reached chain
 *   and should be checked before re-submitting after a restart.
 */
export class IdempotencyManager {
  constructor(
    private readonly store: ClaimStore,
    private readonly chainCheck: (windowStartLedger: number) => Promise<boolean>,
    private readonly claimTtlMs = 60_000,
  ) {}

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
      await this.store.release(ks);
      return false;
    }

    // Safe to submit.
    await submitFn();

    // After successful submit, release the claim so others can observe chain state
    // and not remain wedged by stale claims.
    await this.store.release(ks);
    return true;
  }
}
