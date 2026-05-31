/**
 * SorobanSubscriber — polls a Soroban RPC for contract events and forwards
 * them to a caller-supplied handler.
 *
 * ## Graceful shutdown
 * When `stop()` is called the subscriber:
 *   1. Marks itself stopped so no new polls are started.
 *   2. Aborts the in-flight `getEvents` request via an `AbortController`.
 *   3. Awaits the in-flight poll Promise so the caller can `await stop()` and
 *      be certain no further events will be emitted once the Promise resolves.
 *   4. Silently drops any events that arrive from an aborted poll.
 *
 * ## Deduplication
 * An in-memory LRU set (default cap: 1024 event IDs) suppresses events that
 * have already been emitted. This is best-effort: events outside the window
 * may be re-emitted after a restart.
 */

// ---------------------------------------------------------------------------
// Minimal LRU set (Map-backed, insertion-order eviction).
// ---------------------------------------------------------------------------

class LruSet {
  private readonly map = new Map<string, 1>();

  constructor(private readonly maxSize: number) {}

  has(id: string): boolean {
    return this.map.has(id);
  }

  add(id: string): void {
    if (this.map.has(id)) this.map.delete(id);
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

export interface CursorStoreLike {
  getCursor(): Promise<string | undefined>;
  saveCursor(cursor: string): Promise<void>;
}

export interface SorobanEvent {
  id: string;
  pagingToken: string;
  topic: string[];
  value: unknown;
}

export interface SorobanRpcLike {
  getEvents(
    startCursor: string | undefined,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ events: SorobanEvent[] }>;
}

export interface SorobanSubscriberOptions {
  rpc: SorobanRpcLike;
  cursorStore: CursorStoreLike;
  onEvent: (event: SorobanEvent) => Promise<void>;
  pageSize?: number;
  /** Maximum number of recently-seen event IDs kept in the dedup window. Defaults to 1024. */
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
  private inflightAbort: AbortController | null = null;
  private inflightPoll: Promise<void> | null = null;
  private isPolling = false;

  constructor(options: SorobanSubscriberOptions) {
    this.rpc = options.rpc;
    this.cursorStore = options.cursorStore;
    this.onEvent = options.onEvent;
    this.pageSize = options.pageSize ?? 100;
    this.seen = new LruSet(options.dedupCacheSize ?? 1024);
  }

  async pollOnce(): Promise<void> {
    if (this.isStopped) return;

    const abort = new AbortController();
    this.inflightAbort = abort;

    const poll = this._doPoll(abort.signal);
    this.inflightPoll = poll;

    try {
      await poll;
    } finally {
      if (this.inflightPoll === poll) this.inflightPoll = null;
      if (this.inflightAbort === abort) this.inflightAbort = null;
    }
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    this.inflightAbort?.abort();
    if (this.inflightPoll && !this.isPolling) {
      await this.inflightPoll;
    }
  }

  /** @deprecated Use stop() */
  async shutdown(): Promise<void> {
    return this.stop();
  }

  private async _doPoll(signal: AbortSignal): Promise<void> {
    const currentCursor = await this.cursorStore.getCursor();

    let result: { events: SorobanEvent[] };
    try {
      result = await this.rpc.getEvents(currentCursor, this.pageSize, signal);
    } catch (err) {
      if (this.isAbortError(err)) return;
      throw err;
    }

    this.isPolling = true;
    try {
      for (const event of result.events) {
        if (this.isStopped) return;
        if (this.seen.has(event.id)) continue;
        await this.onEvent(event);
        this.seen.add(event.id);
        await this.cursorStore.saveCursor(event.pagingToken);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      if ((err as { name?: string }).name === "AbortError") return true;
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return true;
    }
    return false;
  }
}
