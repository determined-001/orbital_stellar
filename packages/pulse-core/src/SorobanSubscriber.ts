import type { ContractSubscriptionFilter, ContractAddress } from "./index.js";

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
  contractId?: string;
  type?: string;
}

/** Minimal interface for a Soroban RPC client. */
export interface SorobanRpc {
  getEvents(
    startCursor: string | undefined,
    limit: number,
    signal?: AbortSignal,
    filters?: ContractSubscriptionFilter[]
  ): Promise<{ events: SorobanEvent[] }>;
}

export interface SorobanSubscription {
  id: string;
  filters: ContractSubscriptionFilter[];
  onEvent?: (event: SorobanEvent) => Promise<void>;
}

export interface ReconnectingPayload {
  attempt: number;
  delayMs: number;
  cursor?: string;
  source: "soroban";
}

export interface SorobanSubscriberOptions {
  rpc: SorobanRpc;
  cursorStore: CursorStore;
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
  /** Pagination limit for RPC `getEvents` calls. Must be 1–10,000. Defaults to 100. */
  pageLimit?: number;
  subscriptions?: SorobanSubscription[];
  /** Called when a poll fails and a reconnect is scheduled. */
  onReconnecting?: (payload: ReconnectingPayload) => void;
}

export class SorobanSubscriber {
  private readonly rpc: SorobanRpc;
  private readonly cursorStore: CursorStore;
  private readonly onEvent: (event: SorobanEvent) => Promise<void>;
  private readonly pageSize: number;
  private readonly pageLimit: number;
  private readonly seen: LruSet;
  private readonly onReconnecting?: (payload: ReconnectingPayload) => void;

  public subscriptions: SorobanSubscription[] = [];

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
    this.pageLimit = options.pageLimit ?? 100;

    if (this.pageLimit < 1 || this.pageLimit > 10000) {
      throw new RangeError(
        `pageLimit must be between 1 and 10,000, got ${this.pageLimit}`
      );
    }

    this.seen = new LruSet(options.dedupCacheSize ?? 1024);
    if (options.subscriptions) {
      this.subscriptions = [...options.subscriptions];
    }
    this.onReconnecting = options.onReconnecting;
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
   * Runs a continuous poll loop with exponential-backoff reconnection.
   * Calls `onReconnecting` (if provided) before each retry, passing the
   * cursor captured at the time of failure and `source: 'soroban'`.
   */
  async start(
    reconnect: { initialDelayMs?: number; maxDelayMs?: number } = {}
  ): Promise<void> {
    const initialDelayMs = reconnect.initialDelayMs ?? 1000;
    const maxDelayMs = reconnect.maxDelayMs ?? 30000;
    let attempt = 0;

    while (!this.isStopped) {
      try {
        await this.pollOnce();
      } catch (err) {
        if (this.isStopped) return;

        attempt++;
        const cursor = await this.cursorStore.getCursor().catch(() => undefined);
        const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);

        this.onReconnecting?.({ attempt, delayMs, cursor, source: "soroban" });

        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
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

  private get isReplayMode(): boolean {
    return this.endLedger !== undefined;
  }

  private matchesFilters(
    event: SorobanEvent,
    filters: ContractSubscriptionFilter[]
  ): boolean {
    if (filters.length === 0) return true;

    return filters.some((f) => {
      if (f.type !== undefined && event.type !== undefined && f.type !== event.type) return false;
      if (f.contractIds !== undefined && event.contractId !== undefined && !f.contractIds.includes(event.contractId as ContractAddress)) return false;
      if (f.topicFilters !== undefined) {
        for (let i = 0; i < f.topicFilters.length; i++) {
          const pattern = f.topicFilters[i];
          if (pattern !== null && pattern !== event.topic[i]) return false;
        }
      }
      return true;
    });
  }

  private async _doPoll(signal: AbortSignal): Promise<void> {
    // In replay mode, bail immediately if we've already reached endLedger.
    if (this.isReplayMode && this.replayDone) return;

    let activeSubs = [...this.subscriptions];
    if (activeSubs.length === 0 && this.onEvent) {
      activeSubs = [{ id: "__legacy__", filters: [] }];
    }

    if (activeSubs.length === 0) {
      return;
    }

    let rpcCalls: ContractSubscriptionFilter[][] = [];
    const hasMatchAll = activeSubs.some((sub) => sub.filters.length === 0);

    if (hasMatchAll) {
      rpcCalls = [[]];
    } else {
      const flatFilters: ContractSubscriptionFilter[] = [];
      for (const sub of activeSubs) {
        flatFilters.push(...sub.filters);
      }

      if (flatFilters.length === 0) {
        rpcCalls = [[]];
      } else {
        for (let i = 0; i < flatFilters.length; i += 5) {
          rpcCalls.push(flatFilters.slice(i, i + 5));
        }
      }
    }

    // In replay mode use the ephemeral replayCursor; otherwise read from store.
    const currentCursor = this.isReplayMode
      ? this.replayCursor
      : await this.cursorStore.getCursor();

    const promises = rpcCalls.map((filters) =>
      this.rpc.getEvents(
        currentCursor,
        this.pageSize,
        signal,
        filters.length > 0 ? filters : undefined
      )
    );

    let results: { events: SorobanEvent[] }[];
    try {
      results = await Promise.all(promises);
    } catch (err) {
      // An aborted request is expected during shutdown — swallow it silently.
      if (this.isAbortError(err)) return;
      throw err;
    }

    const allEventsMap = new Map<string, SorobanEvent>();
    for (const res of results) {
      if (res && res.events) {
        for (const event of res.events) {
          allEventsMap.set(event.id, event);
        }
      }
    }

    const uniqueEvents = Array.from(allEventsMap.values());

    if (rpcCalls.length > 1) {
      uniqueEvents.sort((a, b) => a.pagingToken.localeCompare(b.pagingToken));
    }

    this.isPolling = true;
    try {
      for (const event of uniqueEvents) {
        if (this.isStopped) return;
        if (this.seen.has(event.id)) continue;

        const matchedSubs: SorobanSubscription[] = [];
        for (const sub of activeSubs) {
          if (this.matchesFilters(event, sub.filters)) {
            matchedSubs.push(sub);
          }
        }

        if (matchedSubs.length > 0) {
          for (const sub of matchedSubs) {
            if (sub.onEvent) {
              await sub.onEvent(event);
            }
          }

          await this.onEvent(event);
          this.seen.add(event.id);
          await this.cursorStore.saveCursor(event.pagingToken);
        }
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
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n)) return n;
    }
    return undefined;
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
