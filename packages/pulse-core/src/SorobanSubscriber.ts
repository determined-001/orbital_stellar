/**
 * SorobanSubscriber — polls a Soroban RPC for contract events and forwards
 * them to a caller-supplied handler.
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

/** Minimal interface for a cursor persistence layer. */
export interface CursorStore {
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

export interface SorobanSubscriberOptions {
  rpc: SorobanRpc;
  cursorStore: CursorStore;
  onEvent: (event: SorobanEvent) => Promise<void>;
  pageSize?: number;
}

export class SorobanSubscriber {
  private readonly rpc: SorobanRpc;
  private readonly cursorStore: CursorStore;
  private readonly onEvent: (event: SorobanEvent) => Promise<void>;
  private readonly pageSize: number;

  private isStopped = false;

  /** AbortController for the currently in-flight `getEvents` call. */
  private inflightAbort: AbortController | null = null;

  /** Promise for the currently in-flight `pollOnce` call, used by `stop()`. */
  private inflightPoll: Promise<void> | null = null;

  /**
   * True while `_doPoll` is executing.  Used by `stop()` to avoid a deadlock
   * when `stop()` is called from within an `onEvent` handler — in that case
   * we must not await `inflightPoll` because we are already inside it.
   */
  private isPolling = false;

  constructor(options: SorobanSubscriberOptions) {
    this.rpc = options.rpc;
    this.cursorStore = options.cursorStore;
    this.onEvent = options.onEvent;
    this.pageSize = options.pageSize ?? 100;
  }

  /**
   * Executes a single poll cycle:
   *   1. Reads the current cursor from the store.
   *   2. Fetches the next page of events from the RPC.
   *   3. Forwards each event to `onEvent` and advances the cursor.
   *
   * If the subscriber is stopped before or during the poll the method returns
   * early without emitting any further events.
   */
  async pollOnce(): Promise<void> {
    if (this.isStopped) return;

    const abort = new AbortController();
    this.inflightAbort = abort;

    const poll = this._doPoll(abort.signal);
    this.inflightPoll = poll;

    try {
      await poll;
    } finally {
      // Clear references once this poll is done (whether it succeeded,
      // was aborted, or threw for another reason).
      if (this.inflightPoll === poll) {
        this.inflightPoll = null;
      }
      if (this.inflightAbort === abort) {
        this.inflightAbort = null;
      }
    }
  }

  /**
   * Gracefully stops the subscriber.
   *
   * - Marks the subscriber as stopped so no new polls begin.
   * - Aborts any in-flight `getEvents` request.
   * - Awaits the in-flight poll so that, once this Promise resolves, the
   *   caller is guaranteed no further events will be emitted.
   *
   * When called from within an `onEvent` handler (i.e. from inside the poll
   * itself) the await is skipped to avoid a deadlock — the poll will naturally
   * terminate on the next `isStopped` check after `onEvent` returns.
   */
  async stop(): Promise<void> {
    this.isStopped = true;
    this.inflightAbort?.abort();
    // Only await the in-flight poll when we are NOT already inside it.
    // Awaiting from within onEvent would deadlock because the poll is waiting
    // for onEvent to return before it can settle.
    if (this.inflightPoll && !this.isPolling) {
      await this.inflightPoll;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _doPoll(signal: AbortSignal): Promise<void> {
    const currentCursor = await this.cursorStore.getCursor();

    let result: { events: SorobanEvent[] };
    try {
      result = await this.rpc.getEvents(currentCursor, this.pageSize, signal);
    } catch (err) {
      // An aborted request is expected during shutdown — swallow it silently.
      if (this.isAbortError(err)) return;
      throw err;
    }

    this.isPolling = true;
    try {
      for (const event of result.events) {
        // Re-check after every event delivery in case stop() was called
        // concurrently (e.g. from within the onEvent handler).
        if (this.isStopped) return;

        await this.onEvent(event);
        await this.cursorStore.saveCursor(event.pagingToken);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      // DOMException name set by the Fetch API / AbortController
      if ((err as { name?: string }).name === "AbortError") return true;
      // Node.js / undici uses this code
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return true;
    }
    return false;
  }
}
