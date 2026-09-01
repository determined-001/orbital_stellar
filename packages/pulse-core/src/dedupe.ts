/**
 * Duplicate-delivery suppression for the CAP-67 unified stream / Horizon
 * dual-transport period (issue 6.13): during a routing transition (mode
 * switch, `"auto"` fallback recovery) both transports may briefly observe
 * the same on-chain movement, which would otherwise reach a `Watcher` twice.
 *
 * This module is the dedupe *primitive* - a stable key derivation and a
 * bounded window of recently-seen keys. `EventEngine.route()` consults it
 * ahead of `Watcher` fan-out (issue 6.13).
 */

/**
 * The minimum information needed to identify one on-chain *operation*
 * regardless of which transport observed it. Both a Horizon operation record
 * and a CAP-67 unified-stream event carry a transaction hash, and both
 * express the operation's position within that transaction as a TOID -
 * Horizon as the record's `id`, the unified stream as its event `id`'s
 * leading segment. `(txHash, index)` therefore identifies the same operation
 * whichever transport it came from.
 *
 * Note the granularity: an operation, not an event. One operation can emit
 * several unified events, and they all share this ref. {@link DedupeWindow.seenFrom}
 * is what keeps that from collapsing them - see its doc.
 */
export interface DedupeEventRef {
  /** The transaction hash the event/operation belongs to. */
  txHash: string;
  /**
   * Position within the transaction, as a decimal string rather than
   * `number`. Horizon's operation `id` (and the unified stream's per-event
   * `id` prefix) is a TOID - `ledgerSeq * 2^32 + txOrder * 2^12 + opIndex` -
   * which exceeds `Number.MAX_SAFE_INTEGER` past ledger ~2,097,152. Both
   * testnet and pubnet are well past that today, so round-tripping through
   * `Number` silently collapses distinct operations in the same transaction
   * onto the same key. Callers should derive this with `BigInt(id).toString()`,
   * never `Number(id)`.
   */
  index: string;
}

/**
 * Which transport observed an event. The dedupe window suppresses a repeat
 * only when it arrives from the *other* transport - see {@link DedupeWindow.seenFrom}.
 */
export type DedupeTransport = "horizon" | "unified";

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
  /**
   * Recorded keys, each mapped to the set of transports that has observed it.
   * A key identifies an *operation*; the transport set is what lets a single
   * operation legitimately produce several events on one transport without
   * them suppressing each other.
   */
  private readonly seen = new Map<string, Set<DedupeTransport>>();

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

    this.record(key, new Set());
    return false;
  }

  /**
   * Transport-aware duplicate check - the entry point {@link !EventEngine}
   * uses. Returns `true` only when `key` was already observed from the
   * *other* transport, meaning this really is the same on-chain movement
   * arriving twice and the caller should skip delivery.
   *
   * A repeat from the **same** transport returns `false` (deliver it). That
   * case is not a duplicate: a dedupe key is operation-granular - it has to
   * be, since that is the only granularity Horizon and the unified stream
   * both express - while one operation routinely emits several unified
   * events (a multi-hop path payment emits a `transfer` per hop; a contract
   * invocation emits one per leg). Those share a TOID and therefore a key.
   * Suppressing them would silently drop legitimate distinct movements,
   * which is a worse failure than the duplicate this window exists to catch.
   *
   * Recording the transport on a suppressed observation is deliberate: for
   * an operation that produced N events on one transport and 1 on the other,
   * exactly one cross-transport arrival is suppressed and the remaining
   * N - 1 are delivered, so the watcher sees N events either way regardless
   * of which transport observed the operation first.
   */
  seenFrom(key: string, transport: DedupeTransport): boolean {
    const transports = this.seen.get(key);
    if (transports === undefined) {
      this.record(key, new Set([transport]));
      return false;
    }

    // Same transport again - a distinct movement within the same operation.
    if (transports.has(transport)) {
      return false;
    }

    transports.add(transport);
    return true;
  }

  /** Inserts `key`, evicting the oldest entry if that exceeds `capacity`. */
  private record(key: string, transports: Set<DedupeTransport>): void {
    this.seen.set(key, transports);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
  }
}
