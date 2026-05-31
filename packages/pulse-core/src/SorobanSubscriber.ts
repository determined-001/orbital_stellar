/**
 * SorobanSubscriber
 *
 * Polls a Soroban RPC for contract events and forwards them to a caller-
 * supplied handler.
 *
 * ## Deduplication
 * An in-memory LRU set (default cap: **1024** event IDs) suppresses events
 * that have already been emitted.  This is **best-effort**: only event IDs
 * seen within the last `dedupCacheSize` unique emissions are tracked.  Events
 * that fall outside the window may be re-emitted after a restart.  Cursor
 * semantics and pagination are not affected.
 */

// ---------------------------------------------------------------------------
// Minimal LRU set (Map-backed, insertion-order eviction).
// Mirrors the LruCache in packages/abi-registry but kept local to avoid a
// cross-package dependency.
// ---------------------------------------------------------------------------

class LruSet {
  private readonly map = new Map<string, 1>();

  constructor(private readonly maxSize: number) {}

  /** Returns true if the id was already present (duplicate). */
  has(id: string): boolean {
    return this.map.has(id);
  }

  /**
   * Records the id.  If already present the entry is refreshed (moved to
   * most-recently-used position).  Evicts the oldest entry when capacity is
   * exceeded.
   */
  add(id: string): void {
    if (this.map.has(id)) {
      this.map.delete(id);
    }
    this.map.set(id, 1);
    if (this.map.size > this.maxSize) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SorobanEvent {
  id: string;
  pagingToken: string;
  topic: string[];
  value: string;
}

export interface SorobanRpcLike {
  getEvents(
    startCursor: string | undefined,
    limit?: number
  ): Promise<{ events: SorobanEvent[] }>;
}

export interface CursorStoreLike {
  getCursor(): Promise<string | undefined>;
  saveCursor(cursor: string): Promise<void>;
}

export interface SorobanSubscriberOptions {
  rpc: SorobanRpcLike;
  cursorStore: CursorStoreLike;
  onEvent: (event: SorobanEvent) => Promise<void>;
  pageSize?: number;
  /**
   * Maximum number of recently-seen event IDs kept in the dedup window.
   * Defaults to 1024.
   */
  dedupCacheSize?: number;
}

// ---------------------------------------------------------------------------
// SorobanSubscriber
// ---------------------------------------------------------------------------

export class SorobanSubscriber {
  private readonly rpc: SorobanRpcLike;
  private readonly cursorStore: CursorStoreLike;
  private readonly onEvent: (event: SorobanEvent) => Promise<void>;
  private readonly pageSize: number;
  private readonly seen: LruSet;
  private isStopped = false;

  constructor(options: SorobanSubscriberOptions) {
    this.rpc = options.rpc;
    this.cursorStore = options.cursorStore;
    this.onEvent = options.onEvent;
    this.pageSize = options.pageSize ?? 100;
    this.seen = new LruSet(options.dedupCacheSize ?? 1024);
  }

  async pollOnce(): Promise<void> {
    if (this.isStopped) return;

    const currentCursor = await this.cursorStore.getCursor();
    const result = await this.rpc.getEvents(currentCursor, this.pageSize);

    for (const event of result.events) {
      if (this.isStopped) break;

      // Dedup: skip events already seen within the LRU window.
      if (this.seen.has(event.id)) continue;

      await this.onEvent(event);
      this.seen.add(event.id);
      await this.cursorStore.saveCursor(event.pagingToken);
    }
  }

  async shutdown(): Promise<void> {
    this.isStopped = true;
  }
}
