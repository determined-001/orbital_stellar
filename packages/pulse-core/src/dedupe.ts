/**
 * Duplicate-delivery suppression for the CAP-67 unified stream / Horizon
 * dual-transport period (issue 6.13): during a routing transition (mode
 * switch, `"auto"` fallback recovery) both transports may briefly observe
 * the same on-chain movement, which would otherwise reach a `Watcher` twice.
 *
 * This module is the dedupe *primitive* only - a stable key derivation and a
 * bounded window of recently-seen keys. Wiring it into the engine's delivery
 * path ahead of `Watcher` fan-out depends on that path actually existing for
 * both transports (6.12's live routing/dispatch), which isn't wired yet, so
 * that integration is left for when it is.
 */

/**
 * The minimum information needed to identify one on-chain movement
 * regardless of which transport observed it. Both a Horizon operation record
 * and a CAP-67 unified-stream event carry a transaction hash; `index` is the
 * operation's position within that transaction (Horizon) or the unified
 * event's ordinal (RPC) - either way, `(txHash, index)` together identify
 * the same movement whichever transport it came from.
 */
export interface DedupeEventRef {
  /** The transaction hash the event/operation belongs to. */
  txHash: string;
  /** Position within the transaction. */
  index: number;
}

/**
 * Derives a stable dedupe key from a {@link DedupeEventRef}. Two refs for the
 * same on-chain movement - one built from a Horizon operation, one from a
 * unified-stream event - produce an identical key.
 */
export function deriveDedupeKey(ref: DedupeEventRef): string {
  return `${ref.txHash}:${ref.index}`;
}

/** Thrown by {@link DedupeWindow}'s constructor for a non-positive-integer capacity. */
export class InvalidDedupeWindowCapacityError extends Error {
  constructor(capacity: number) {
    super(`[pulse-core] DedupeWindow: capacity must be a positive integer, got ${capacity}`);
    this.name = "InvalidDedupeWindowCapacityError";
  }
}

/**
 * A bounded window of recently-seen dedupe keys. Once at capacity, the
 * least-recently-added key is evicted to admit a new one - memory stays
 * bounded by `capacity` regardless of how many keys are ever checked over
 * the window's lifetime.
 *
 * Usage: call {@link seenBefore} with a key derived from {@link deriveDedupeKey}
 * immediately before delivering an event; skip delivery if it returns `true`.
 */
export class DedupeWindow {
  private readonly capacity: number;
  private readonly seen = new Map<string, true>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidDedupeWindowCapacityError(capacity);
    }
    this.capacity = capacity;
  }

  /** Number of keys currently held in the window. Never exceeds `capacity`. */
  get size(): number {
    return this.seen.size;
  }

  /**
   * Returns `true` if `key` was already recorded within the window (a
   * duplicate - the caller should skip delivery). Otherwise records it and
   * returns `false`. Evicts the oldest recorded key first if this insertion
   * would exceed `capacity`, so the window never grows unbounded.
   */
  seenBefore(key: string): boolean {
    if (this.seen.has(key)) {
      return true;
    }

    this.seen.set(key, true);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    return false;
  }
}
