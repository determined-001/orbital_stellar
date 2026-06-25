/**
 * SorobanSubscriber — polls a Soroban RPC for contract events and forwards
 * them to a caller-supplied handler.
 *
 * CursorStore integration (Issue #296)
 * ------------------------------------
 * - Uses `streamKey` when provided; otherwise defaults to `soroban:${network}`
 *   is expected to be passed in by the caller.
 * - On `pollOnce()` it calls `cursorStore.get(streamKey)`; if present it uses
 *   the stored cursor, otherwise starts from the beginning (undefined).
 * - After each successfully delivered event it calls `cursorStore.set(streamKey, cursor)`.
 *   Cursor persistence errors are tolerated (warn only) and do not block delivery.
 *
 * Graceful shutdown guarantee
 * ---------------------------
 * When `stop()` is called the subscriber:
 *   1. Marks itself stopped so no new polls are started.
 *   2. Aborts the in-flight `getEvents` request via an `AbortController`.
 *   3. Awaits the in-flight poll Promise so the caller can `await stop()` and
 *      be certain no further events will be emitted once the Promise resolves.
 *   4. Silently drops any events that arrive from an aborted poll.
 */

import type { CursorStore } from "./index.js";

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
  /** Minimal interface for a cursor persistence layer. */
  getCursor(): Promise<string | undefined>;
  saveCursor(cursor: string): Promise<void>;
}

/** A single event returned by the Soroban RPC. */
export interface SorobanEvent {
  id: string;
  pagingToken: string;
  topic: string[];
  value: unknown;
}

/** Minimal interface for a Soroban RPC client. */
export interface SorobanRpc {
  getEvents(
    startCursor: string | undefined,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ events: SorobanEvent[] }>;
}

// Back-compat alias used across tests/consumers.
export type SorobanRpcLike = SorobanRpc;

export interface SorobanSubscriberOptions {
  rpc: SorobanRpcLike;
  cursorStore: CursorStoreLike | CursorStore;
  /** When set, the subscriber will use this exact stream key. */
  streamKey?: string;
  onEvent: (event: SorobanEvent) => Promise<void>;
  /** Maximum number of events per poll. Must be 1–10,000. Defaults to 100. */
  pageLimit?: number;
  /** Dedup window size for recently seen event IDs. Defaults to 1024. */
  dedupCacheSize?: number;

  // Bounded replay mode (kept for compatibility with existing code/tests)
  endLedger?: number;
  onDone?: () => void;
  pageSize?: number;
}

export class SorobanSubscriber {
  private readonly rpc: SorobanRpc;
  private readonly cursorStore: CursorStoreLike | CursorStore;
  private readonly streamKey?: string;
  private readonly onEvent: (event: SorobanEvent) => Promise<void>;
  private readonly pageLimit: number;
  private readonly seen: LruSet;

  private isStopped = false;

  /** AbortController for the currently in-flight `getEvents` call. */
  private inflightAbort: AbortController | null = null;

  /** Promise for the currently in-flight `pollOnce` call, used by `stop()`. */
  private inflightPoll: Promise<void> | null = null;

  /** True while `_doPoll` is executing. */
  private isPolling = false;

  // Bounded replay state
  private replayCursor: string | undefined;
  private deliveredInReplay = false;
  private endLedger?: number;
  private onDone?: () => void;

  constructor(options: SorobanSubscriberOptions) {
    this.rpc = options.rpc;
    this.cursorStore = options.cursorStore;
    this.streamKey = options.streamKey;
    this.onEvent = options.onEvent;
    this.pageLimit = options.pageLimit ?? 100;

    if (this.pageLimit < 1 || this.pageLimit > 10000) {
      throw new RangeError(
        `pageLimit must be between 1 and 10,000, got ${this.pageLimit}`
      );
    }

    this.seen = new LruSet(options.dedupCacheSize ?? 1024);

    this.endLedger = options.endLedger;
    this.onDone = options.onDone;
    // replayCursor is initialized lazily on first poll.
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

  private get isReplayMode(): boolean {
    return this.endLedger !== undefined;
  }

  private get replayDone(): boolean {
    // In bounded replay we stop once a delivered event is >= endLedger.
    return this.deliveredInReplay;
  }

  private async _doPoll(signal: AbortSignal): Promise<void> {
    // Choose cursor
    const durableCursor = await this.getDurableCursor();
    const startCursor = this.isReplayMode ? this.replayCursor : durableCursor;

    if (this.isReplayMode && this.replayDone) return;

    let result: { events: SorobanEvent[] };
    try {
      result = await this.rpc.getEvents(startCursor, this.pageLimit, signal);
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

        // Update replay cursor or durable cursor
        if (this.isReplayMode) {
          this.replayCursor = event.pagingToken;

          const ledger = this.extractLedger(event);
          if (ledger !== undefined && this.endLedger !== undefined && ledger >= this.endLedger) {
            this.deliveredInReplay = true;
            this.onDone?.();
          }
          // In replay mode we intentionally do NOT persist.
          continue;
        }

        await this.persistCursor(event.pagingToken);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private isDurableCursorStore(store: CursorStoreLike | CursorStore): store is CursorStore {
    return typeof (store as CursorStore).get === "function" && typeof (store as CursorStore).set === "function";
  }

  private async getDurableCursor(): Promise<string | undefined> {
    if (this.isDurableCursorStore(this.cursorStore)) {
      if (!this.streamKey) return undefined;
      const cursor = await this.cursorStore.get(this.streamKey);
      return cursor ?? undefined;
    }

    try {
      return await this.cursorStore.getCursor();
    } catch {
      return undefined;
    }
  }

  private async persistCursor(cursor: string): Promise<void> {
    if (this.isDurableCursorStore(this.cursorStore)) {
      if (!this.streamKey) return;
      try {
        await this.cursorStore.set(this.streamKey, cursor);
      } catch (err) {
        // Required: warn but do not block delivery.
        console.warn("[pulse-core] Soroban cursorStore.set() failed.", err);
      }
      return;
    }

    try {
      await this.cursorStore.saveCursor(cursor);
    } catch (err) {
      console.warn("[pulse-core] Soroban cursorStore.saveCursor() failed.", err);
    }
  }

  private extractLedger(event: SorobanEvent): number | undefined {
    const raw = event as unknown as Record<string, unknown>;
    if (typeof raw.ledger === "number") return raw.ledger;

    const match = event.id.match(/^(\d+)-/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n)) return n;
    }
    return undefined;
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      if ((err as { name?: string }).name === "AbortError") return true;
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string" && code === "ABORT_ERR") return true;
    }
    return false;
  }
}

