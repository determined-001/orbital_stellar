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
  /**
   * When set, the subscriber operates in bounded-replay mode: polling stops
   * (and `onDone` is called) once every event whose ledger is strictly less
   * than `endLedger` has been delivered.  The cursor store is **not** updated
   * during replay — progress is ephemeral and intentionally discarded.
   */
  endLedger?: number;
  /** Called once when a bounded replay run has delivered all events up to endLedger. */
  onDone?: () => void;
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
  private readonly endLedger?: number;
  private readonly onDone?: () => void;
  /**
   * In replay mode, tracks the ephemeral cursor for the current run.
   * Never written to cursorStore — replay progress is intentionally discarded.
   */
  private replayCursor: string | undefined = undefined;
  private replayDone = false;

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
    this.endLedger = options.endLedger;
    this.onDone = options.onDone;
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

  private get isReplayMode(): boolean {
    return this.endLedger !== undefined;
  }

  private async _doPoll(signal: AbortSignal): Promise<void> {
    // In replay mode, bail immediately if we've already reached endLedger.
    if (this.isReplayMode && this.replayDone) return;

    // In replay mode use the ephemeral replayCursor; otherwise read from store.
    const currentCursor = this.isReplayMode
      ? this.replayCursor
      : await this.cursorStore.getCursor();

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
        // Bounded-replay: stop when we reach or exceed endLedger (exclusive).
        if (this.isReplayMode && this.endLedger !== undefined) {
          const eventLedger = this.extractLedger(event);
          if (eventLedger !== undefined && eventLedger >= this.endLedger) {
            this.replayDone = true;
            this.isStopped = true;
            this.onDone?.();
            return;
          }
        }

        if (this.seen.has(event.id)) continue;
        await this.onEvent(event);
        this.seen.add(event.id);

        // Replay mode: advance the ephemeral cursor but do NOT persist to cursorStore.
        if (this.isReplayMode) {
          this.replayCursor = event.pagingToken;
        } else {
          await this.cursorStore.saveCursor(event.pagingToken);
        }
      }

      // If the page was exhausted without hitting endLedger and we're in replay
      // mode, check if there are simply no more events (empty page = done).
      if (this.isReplayMode && result.events.length === 0 && !this.replayDone) {
        this.replayDone = true;
        this.isStopped = true;
        this.onDone?.();
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Extracts the ledger sequence number from a SorobanEvent.
   * The Soroban RPC embeds the ledger in the event `id` field as
   * `<ledger>-<index>` (e.g. "1234-0").  Falls back to a `ledger` field if
   * present on the raw event object.
   */
  private extractLedger(event: SorobanEvent): number | undefined {
    // Prefer explicit ledger field (available in some RPC responses).
    const raw = event as unknown as Record<string, unknown>;
    if (typeof raw.ledger === "number") return raw.ledger;

    // Parse from paging token / id encoded as "<ledger>-<index>".
    const match = event.id.match(/^(\d+)-/);
    if (match && match[1]) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n)) return n;
    }
    return undefined;
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      if ((err as { name?: string }).name === "AbortError") return true;
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return true;
    }
    return false;
  }
}
