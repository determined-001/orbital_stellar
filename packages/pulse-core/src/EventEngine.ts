import { Horizon } from "@stellar/stellar-sdk";
import { Watcher } from "./Watcher.js";
import { EngineAlreadyStartedError, HorizonStreamError } from "./errors.js";
import { SorobanSubscriber } from "./SorobanSubscriber.js";
import type { ReplayOptions } from "./SorobanSubscriber.js";
import { toAccountAddress, toContractAddress } from "./address.js";
import type { ContractAddress } from "./address.js";
import type {
  AccountCreatedEvent,
  AccountEventType,
  AccountMergeEvent,
  AccountOptionsChanges,
  AccountOptionsEvent,
  AbiRegistryClientLike,
  BumpSequenceEvent,
  BumpSequenceEventType,
  ClaimableBalanceClaimant,
  ClaimableClaimedEvent,
  ClaimableCreatedEvent,
  ContractEmittedEvent,
  ContractInvokedEvent,
  ContractSubscribeOptions,
  ContractSubscriptionFilter,
  CoreConfig,
  DataEvent,
  DataEventType,
  EngineStatus,
  HealthCheckResult,
  LiquidityPoolDepositEvent,
  LiquidityPoolReserve,
  LiquidityPoolWithdrawEvent,
  Network,
  NormalizedEvent,
  OfferEvent,
  OfferEventType,
  PaymentEvent,
  PaymentEventType,
  ReconnectConfig,
  SubscribeOptions,
  TrustAuthEvent,
  TrustAuthEventType,
  TrustlineEvent,
  TrustlineEventType,
  WatcherNotification,
  WatcherNotificationType,
  Logger,
  CursorStore,
} from "./index.js";
import { UnknownNetworkError } from "./index.js";

type PendingPaymentEvent = Omit<PaymentEvent, "type"> & { type: "unknown" };
type NormalizedEventOrPending =
  | PendingPaymentEvent
  | AccountOptionsEvent
  | AccountCreatedEvent
  | TrustlineEvent
  | AccountMergeEvent
  | OfferEvent
  | BumpSequenceEvent
  | DataEvent
  | ClaimableCreatedEvent
  | ClaimableClaimedEvent
  | LiquidityPoolDepositEvent
  | LiquidityPoolWithdrawEvent
  | TrustAuthEvent
  | ContractInvokedEvent
  | ContractEmittedEvent;

type StreamCallbacks = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type HorizonStreamStopper = ReturnType<
  ReturnType<Horizon.Server["payments"]>["stream"]
>;

const HORIZON_URLS: Record<Network, string> = {
  mainnet: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
};

const DEFAULT_RECONNECT: Required<ReconnectConfig> = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxRetries: Number.POSITIVE_INFINITY,
};

const STELLAR_MAX_TRUSTLINE_LIMIT = "922337203685.4775807";

const noop: Logger = { info: () => { }, warn: () => { }, error: () => { } };

export class EventEngine {
  private server: Horizon.Server;
  private registry: Map<string, Watcher> = new Map();
  private contractRegistry: Map<string, { watcher: Watcher; filters: ContractSubscriptionFilter[] }> = new Map();
  private subscriptionNames: Map<string, string> = new Map();
  private stopStream: HorizonStreamStopper | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pendingReconnectSuccessAttempt: number | null = null;
  private readonly reconnectConfig: Required<ReconnectConfig>;
  private readonly network: Network;
  private isRunning = false;
  // Waiters for contract subscription activation: map contractId -> array of waiters
  private contractPollWaiters: Map<
    string,
    Array<{
      topics?: string[] | undefined;
      resolve: () => void;
      reject: (err: unknown) => void;
      timeout?: ReturnType<typeof setTimeout> | null;
    }>
  > = new Map();
  private lastEventAt: string | null = null;
  private horizonCursor?: string;
  private filters: Map<string, (event: NormalizedEvent) => boolean> = new Map();
  private log: Required<NonNullable<CoreConfig["logger"]>>;
  private cursorStore?: CursorStore;
  private streamKey: string;
  private cursorFailureThreshold: number;
  private consecutiveCursorFailures = 0;
  private isCursorStoreUnhealthy = false;
  private pausedSources = new Set<"horizon" | "soroban">();

  /**
   * Creates a new EventEngine instance.
   * @param config - The core configuration for the engine.
   */
  constructor(config: CoreConfig) {
    let horizonUrl: string;
    if (config.horizonUrl !== undefined) {
      try {
        const parsed = new URL(config.horizonUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("must be an http or https URL");
        }
      } catch (err) {
        throw new Error(`Invalid horizonUrl: ${(err as Error).message}`);
      }
      horizonUrl = config.horizonUrl;
    } else {
      const fromNetwork = HORIZON_URLS[config.network];
      if (!fromNetwork) {
        throw new UnknownNetworkError(config.network);
      }
      horizonUrl = fromNetwork;
    }
    this.server = new Horizon.Server(horizonUrl);
    this.reconnectConfig = {
      ...DEFAULT_RECONNECT,
      ...config.reconnect,
    };
    this.log = config.logger ?? noop;
    this.network = config.network;
    this.cursorStore = config.cursorStore;
    this.streamKey = config.streamKey ?? "pulse-core-cursor";
    this.cursorFailureThreshold = config.cursorFailureThreshold ?? 5;
  }

  /**
   * Wait until a contract subscription has been observed in a poll/getEvents call.
   * Resolves when a poll covering the supplied filter (contractId + topics)
   * has been observed via `notifyContractPolled`.
   * Rejects on timeout.
   */
  awaitContractSubscriptionActive(
    config: { contractId: string; topics?: string[] },
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? 5000;
    const { contractId, topics } = config;

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        topics: topics ?? undefined,
        resolve: () => {
          this.clearContractWaiter(contractId, waiter);
          resolve();
        },
        reject: (err: unknown) => {
          this.clearContractWaiter(contractId, waiter);
          reject(err);
        },
        timeout: null as ReturnType<typeof setTimeout> | null,
      };

      // start timeout
      const t = setTimeout(() => {
        waiter.timeout = null;
        waiter.reject(new Error("awaitContractSubscriptionActive: timeout"));
      }, timeoutMs);
      waiter.timeout = t;

      const arr = this.contractPollWaiters.get(contractId) ?? [];
      arr.push(waiter);
      this.contractPollWaiters.set(contractId, arr);
    });
  }

  private clearContractWaiter(
    contractId: string,
    waiter: { timeout?: ReturnType<typeof setTimeout> | null },
  ) {
    const arr = this.contractPollWaiters.get(contractId);
    if (!arr) return;
    const idx = arr.indexOf(waiter as any);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this.contractPollWaiters.delete(contractId);
    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
      waiter.timeout = null;
    }
  }

  /**
   * Notify the engine that a polling/getEvents call for `contractId` occurred.
   * `polledTopics` is the topics array used in that call (may be undefined/null to mean "all topics").
   * This will resolve any pending `awaitContractSubscriptionActive` promises whose
   * requested topics are covered by the polled topics.
   */
  notifyContractPolled(
    contractId: string,
    polledTopics?: string[] | null,
  ): void {
    const waiters = this.contractPollWaiters.get(contractId);
    if (!waiters || waiters.length === 0) return;

    for (const waiter of [...waiters]) {
      const want = waiter.topics;
      // If the waiter didn't request specific topics, any poll for the contract satisfies it.
      if (!want || want.length === 0) {
        waiter.resolve();
        continue;
      }

      // If the poll had no topic restriction (polledTopics null/undefined), it covers everything.
      if (!polledTopics || polledTopics.length === 0) {
        waiter.resolve();
        continue;
      }

      // Otherwise ensure all requested topics are included in the polled topics.
      const polledSet = new Set(polledTopics);
      const allIncluded = want.every((t) => polledSet.has(t));
      if (allIncluded) {
        waiter.resolve();
      }
    }
  }

  /**
   * Subscribes to events for a given Stellar address.
   * Returns an existing Watcher if one already exists for the address.
   * @param address - The Stellar address to watch.
   * @param options - Optional subscription options, including a filter predicate.
   * @returns The Watcher instance for the address.
   */
  subscribe(address: string, options?: SubscribeOptions): Watcher {
    const existingWatcher = this.registry.get(address);
    if (existingWatcher) {
      if (options?.filter) {
        this.log.warn(
          `[pulse-core] subscribe() called for address ${address} which already has an active watcher — filter option ignored.`,

          { address, hasFilter: true }
        );
      }
      return existingWatcher;
    }

    const watcher = new Watcher(address);
    if (options?.name !== undefined) {
      this.subscriptionNames.set(address, options.name);
    }
    if (options?.filter) {
      this.filters.set(address, options.filter);
    }
    watcher.addStopHandler(() => {
      this.registry.delete(address);
      this.filters.delete(address);
      this.subscriptionNames.delete(address);
    });
    this.registry.set(address, watcher);
    return watcher;
  }

  /**
   * Unsubscribes from events for a given Stellar address and stops its watcher.
   * @param address - The Stellar address to stop watching.
   */
  unsubscribe(address: string): void {
    this.registry.get(address)?.stop();
  }

  /**
   * Stops all active watchers without closing the underlying SSE stream.
   * Use this to drain subscriptions while keeping the stream open.
   */
  unsubscribeAll(): void {
    for (const watcher of this.registry.values()) {
      watcher.stop();
    }
  }

  /**
   * Subscribes to Soroban contract events matching the given filters.
   * Returns a Watcher that emits "contract.invoked", "contract.emitted", and "*".
   * Multiple calls with different filters create independent subscriptions.
   * @param id - A caller-chosen identifier for this subscription (used to unsubscribe).
   * @param options - Optional filters; omitting filters matches all contract events.
   */
  subscribeContract(id: string, options?: ContractSubscribeOptions): Watcher {
    const existing = this.contractRegistry.get(id);
    if (existing) {
      if (options?.filter) {
        this.log.warn(
          `[pulse-core] subscribeContract() called for ${this.describeSubscription(id)} which already has an active watcher — filter option ignored.`
        );
      }
      return existing.watcher;
    }

    const watcher = new Watcher(id);
    const filters = options?.filters ?? [];
    if (options?.name !== undefined) {
      this.subscriptionNames.set(id, options.name);
    }
    if (options?.filter) {
      this.filters.set(id, options.filter);
    }
    watcher.addStopHandler(() => {
      this.contractRegistry.delete(id);
      this.subscriptionNames.delete(id);
      this.filters.delete(id);
    });
    this.contractRegistry.set(id, { watcher, filters });
    return watcher;
  }

  /**
   * Removes a contract subscription by its id.
   */
  unsubscribeContract(id: string): void {
    this.contractRegistry.get(id)?.watcher.stop();
  }

  /**
   * Performs a one-shot bounded replay of Soroban contract events between two
   * ledger positions.
   *
   * - Events are delivered to `onEvent` in ledger order.
   * - `onDone` is called once every event whose ledger is < `endLedger` has
   *   been delivered, or when the RPC reports no further events.
   * - The `CursorStore` is **not** consulted or updated during replay: cursors
   *   are ephemeral and progress is intentionally discarded when the run ends.
   *
   * @param options.rpc         - A Soroban RPC client compatible with `SorobanRpcLike`.
   * @param options.filters     - Optional contract subscription filters (same semantics as `subscribeContract`).
   * @param options.startLedger - Ledger sequence to begin replay from (passed as initial cursor hint).
   * @param options.endLedger   - Ledger sequence at which replay stops (exclusive).
   * @param options.onEvent     - Called for every event in range.
   * @param options.onDone      - Called once when replay is complete.
   * @param options.pageSize    - Optional page size override (default 100).
   */
  replayContracts(options: {
    rpc: SorobanRpcLike;
    filters?: ContractSubscriptionFilter[];
    startLedger: number;
    endLedger: number;
    onEvent: (event: SorobanEvent) => Promise<void>;
    onDone: () => void;
    pageSize?: number;
  }): SorobanSubscriber {
    // A no-op CursorStore: replay never reads from or writes to persistent storage.
    const noCursorStore = {
      async getCursor(): Promise<string | undefined> {
        return undefined;
      },
      async saveCursor(_cursor: string): Promise<void> {
        // intentional no-op — replay does not persist cursor progress
      },
    };

    const subscriber = new SorobanSubscriber({
      rpc: options.rpc,
      cursorStore: noCursorStore,
      onEvent: options.onEvent,
      endLedger: options.endLedger,
      onDone: options.onDone,
      pageSize: options.pageSize,
    });

    return subscriber;
  }

  /**
   * Stops all active contract watchers without halting the Soroban subscriber
   * or the underlying Horizon SSE stream.
   * Emits an `engine.stopped` notification to each contract watcher before
   * tearing it down.
   */
  unsubscribeAllContracts(): void {
    for (const [id, entry] of this.contractRegistry.entries()) {
      const name = this.subscriptionNames.get(id);
      const notification = {
        type: "engine.stopped" as const,
        attempt: 0,
        emittedAt: new Date().toISOString(),
        ...(name !== undefined ? { name } : {}),
      };
      entry.watcher.emit("engine.stopped", notification);
      entry.watcher.stop();
    }
  }

  /**
   * Starts the SSE stream to listen for Stellar network events.
   * Returns true if started, false if already running.
   * Pass `{ strict: true }` to throw EngineAlreadyStartedError instead of returning false.
   */
  start(options?: { strict?: boolean }): boolean {
    if (this.isRunning || this.reconnectTimer) {
      if (options?.strict) {
        throw new EngineAlreadyStartedError();
      }
      this.log.warn(
        "[pulse-core] EventEngine.start() called while the SSE stream is already active.",
        {
          isRunning: this.isRunning,
          reconnectTimerActive: this.reconnectTimer !== null,
        }
      );
      return false;
    }

    // Detect Soroban RPC / network drift if a cached network is available.
    // This check is intentionally synchronous so any mismatch can be reported
    // immediately before opening subscriptions. Tests populate the SorobanRpcClient cache.
    try {
      const { SorobanRpcClient } = require("./SorobanRpcClient.js");
      const cached = SorobanRpcClient.getCachedNetwork();
      if (cached) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { NETWORK_PASSPHRASES } = require("./index.js");
        const expected = NETWORK_PASSPHRASES[this.network];
        const actual = cached.passphrase;
        if (actual !== expected) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { NetworkMismatchError } = require("./errors.js");
          throw new NetworkMismatchError(expected, actual);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "NetworkMismatchError") {
        throw e;
      }
      // Otherwise ignore missing cache or other non-fatal failures — no drift detection available.
    }

    this.openStream(false);
    return true;
  }

  async healthCheck(thresholdMs = 5 * 60 * 1000): Promise<HealthCheckResult> {
    const reasons: string[] = [];
    if (!this.isRunning) {
      reasons.push("engine is not running");
    }
    if (this.lastEventAt === null) {
      reasons.push("no events received yet");
    } else {
      const age = Date.now() - new Date(this.lastEventAt).getTime();
      if (age > thresholdMs) {
        reasons.push(`last event was ${Math.floor(age / 1000)}s ago (threshold ${Math.floor(thresholdMs / 1000)}s)`);
      }
    }
    if (this.cursorStore?.ping) {
      try {
        await this.cursorStore.ping();
      } catch (err) {
        reasons.push(`cursorStore: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  /**
   * Pauses event emission from a specific source (Horizon or Soroban).
   * Paused sources stop emitting events but the stream remains open.
   * Cursors persist via CursorStore so resume continues from the last point.
   * @param source - The source to pause: "horizon" or "soroban"
   */
  pauseSource(source: "horizon" | "soroban"): void {
    if (this.pausedSources.has(source)) {
      this.log.warn(`[pulse-core] pauseSource("${source}") called but source is already paused.`);
      return;
    }
    this.pausedSources.add(source);
    this.log.info(`[pulse-core] Source "${source}" paused.`);
  }

  /**
   * Resumes event emission from a specific paused source.
   * Continues from the last delivered cursor position.
   * @param source - The source to resume: "horizon" or "soroban"
   */
  resumeSource(source: "horizon" | "soroban"): void {
    if (!this.pausedSources.has(source)) {
      this.log.warn(`[pulse-core] resumeSource("${source}") called but source is not paused.`);
      return;
    }
    this.pausedSources.delete(source);
    this.log.info(`[pulse-core] Source "${source}" resumed.`);
  }

  /**
   * Stops the SSE stream and all active watchers.
   * Cleans up all resources and resets reconnection state.
   */
  stop(): void {
    this.clearReconnectTimer();
    this.pendingReconnectSuccessAttempt = null;
    this.reconnectAttempt = 0;
    this.lastEventAt = null;
    this.closeStream();
    this.isRunning = false;
    this.horizonCursor = undefined;
    this.pausedSources.clear();

    this.notifyWatchers("engine.stopped", {
      type: "engine.stopped",
      attempt: 0,
      emittedAt: new Date().toISOString(),
    });

    for (const watcher of this.registry.values()) {
      watcher.stop();
    }
  }

  status(): EngineStatus {
    const horizon = {
      running: this.isRunning,
      lastEventAt: this.lastEventAt,
      reconnectAttempt: this.reconnectAttempt,
      cursor: this.horizonCursor,
    };

    const soroban = {
      running: false,
      lastEventAt: null,
      reconnectAttempt: 0,
    };

    const sources = { horizon, soroban };
    const lastEventAt = [horizon.lastEventAt, soroban.lastEventAt].filter(
      (value): value is string => value !== null
    );

    return {
      running: horizon.running || soroban.running,
      watcherCount: this.registry.size,
      contractWatcherCount: this.contractRegistry.size,
      lastEventAt: lastEventAt.length
        ? (lastEventAt.sort()[lastEventAt.length - 1] ?? null)
        : null,
      reconnectAttempt: Math.max(horizon.reconnectAttempt, soroban.reconnectAttempt),
      pausedSources: this.pausedSources.size > 0 ? Array.from(this.pausedSources) : undefined,
      sources,
    };
  }

  private openStream(isReconnect: boolean): void {
    this.closeStream();
    this.clearReconnectTimer();
    this.isRunning = true;
    this.horizonCursor = "now";
    this.pendingReconnectSuccessAttempt = isReconnect
      ? this.reconnectAttempt
      : null;

    const callbacks: StreamCallbacks = {
      onmessage: (record) => {
        this.lastEventAt = new Date().toISOString();
        if (this.pendingReconnectSuccessAttempt !== null) {
          // Report the same attempt number that was emitted in engine.reconnecting.
          const attempt = this.pendingReconnectSuccessAttempt;
          this.pendingReconnectSuccessAttempt = null;
          this.reconnectAttempt = 0;
          this.log.info(
            `[pulse-core] SSE reconnect succeeded on attempt ${attempt}.`,
          );
          this.notifyWatchers("engine.reconnected", {
            type: "engine.reconnected",
            attempt,
            emittedAt: new Date().toISOString(),
          });
        }

        const event = this.normalize(record);
        if (!event) {
          return;
        }

        this.lastEventAt = event.timestamp;
        this.route(event);
      },
      onerror: (error) => {
        this.log.error("[pulse-core] SSE error.", { error });
        this.handleStreamError(error);
      },
    };

    this.stopStream = this.server.operations().cursor("now").stream(callbacks);
  }

  private handleStreamError(error?: unknown): void {
    if (this.reconnectTimer) {
      return;
    }

    this.closeStream();
    this.isRunning = false;
    this.pendingReconnectSuccessAttempt = null;

    const nextAttempt = this.reconnectAttempt + 1;
    if (nextAttempt > this.reconnectConfig.maxRetries) {
      this.log.error(
        `[pulse-core] SSE reconnect stopped after ${this.reconnectAttempt} failed attempts.`,
      );
      return;
    }

    this.reconnectAttempt = nextAttempt;

    const isRateLimited = this.isRateLimitError(error);

    let delayMs: number;
    if (isRateLimited) {
      const retryAfterMs = this.parseRetryAfterMs(error);
      delayMs = retryAfterMs ?? 60000;

      this.log.warn(
        `[pulse-core] SSE rate limited by Horizon, reconnect scheduled in ${delayMs}ms.`,
      );
      this.notifyWatchers("engine.rate_limited", {
        type: "engine.rate_limited",
        attempt: nextAttempt,
        delayMs,
        emittedAt: new Date().toISOString(),
      });
    } else {
      const exponentialDelay = Math.min(
        this.reconnectConfig.initialDelayMs * 2 ** (nextAttempt - 1),
        this.reconnectConfig.maxDelayMs,
      );
      delayMs = Math.floor(Math.random() * exponentialDelay);

      this.log.warn(
        `[pulse-core] SSE reconnect attempt ${nextAttempt} scheduled in ${delayMs}ms.`,
      );
      this.notifyWatchers("engine.reconnecting", {
        type: "engine.reconnecting",
        attempt: nextAttempt,
        delayMs,
        emittedAt: new Date().toISOString(),
      });
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openStream(true);
    }, delayMs);
  }

  private isRateLimitError(error: unknown): boolean {
    const status = this.extractStatus(error);
    return status === 429;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private getNumericField(record: Record<string, unknown>, field: string): number | undefined {
    const value = record[field];
    return typeof value === "number" ? value : undefined;
  }

  private getStringField(record: Record<string, unknown>, field: string): string | null {
    const value = record[field];
    return typeof value === "string" ? value : null;
  }

  private isHeaderMap(value: unknown): value is { get(name: string): string | null } {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { get?: unknown }).get === "function"
    );
  }

  private extractStatus(error: unknown): number | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    return (
      this.getNumericField(error, "status") ??
      this.getNumericField(error, "statusCode") ??
      (this.isRecord(error.response)
        ? this.getNumericField(error.response, "status") ??
        this.getNumericField(error.response, "statusCode")
        : undefined)
    );
  }

  private getHeaderValue(error: unknown, headerName: string): string | null {
    if (!this.isRecord(error)) {
      return null;
    }

    const lowerName = headerName.toLowerCase();
    const directHeader =
      this.getStringField(error, headerName) ??
      this.getStringField(error, lowerName);
    if (directHeader) {
      return directHeader;
    }

    const responseHeaders =
      this.isRecord(error.response) && this.isRecord(error.response.headers)
        ? error.response.headers
        : undefined;

    for (const headers of [error.headers, responseHeaders]) {
      const value = this.getHeaderValueFromHeaders(headers, headerName);
      if (value) {
        return value;
      }
    }

    return null;
  }

  private getHeaderValueFromHeaders(headers: unknown, headerName: string): string | null {
    const lowerName = headerName.toLowerCase();

    if (this.isHeaderMap(headers)) {
      const value = headers.get(headerName) ?? headers.get(lowerName);
      return typeof value === "string" ? value : null;
    }

    if (!this.isRecord(headers)) {
      return null;
    }

    return (
      this.getStringField(headers, headerName) ??
      this.getStringField(headers, lowerName)
    );
  }

  private parseRetryAfterMs(error: unknown): number | null {
    const header = this.getHeaderValue(error, "Retry-After");
    if (!header) {
      return null;
    }

    const seconds = Number.parseInt(header, 10);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }

    const date = new Date(header).getTime();
    return Number.isNaN(date) ? null : Math.max(date - Date.now(), 0);
  }

  private getHeaderValue(error: unknown, headerName: string): string | null {
    const e = error as Record<string, unknown>;
    const directHeader =
      typeof e[headerName.toLowerCase()] === "string"
        ? (e[headerName.toLowerCase()] as string)
        : typeof e[headerName] === "string"
          ? (e[headerName] as string)
          : null;
    if (directHeader) {
      return directHeader;
    }

    const response = e.response as Record<string, unknown> | undefined;
    const candidates = [e.headers, response?.headers];

    for (const headers of candidates) {
      if (!headers || typeof headers !== "object") {
        continue;
      }

      if (typeof (headers as any).get === "function") {
        const value =
          (headers as any).get(headerName) ??
          (headers as any).get(headerName.toLowerCase());
        if (typeof value === "string") {
          return value;
        }
      }

      const value =
        typeof (headers as any)[headerName] === "string"
          ? (headers as any)[headerName]
          : typeof (headers as any)[headerName.toLowerCase()] === "string"
            ? (headers as any)[headerName.toLowerCase()]
            : null;

      if (typeof value === "string") {
        return value;
      }
    }

    return null;
  }

  private closeStream(): void {
    if (!this.stopStream) {
      return;
    }

    const stopStream = this.stopStream;
    this.stopStream = null;
    stopStream();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private notifyWatchers(
    eventType: WatcherNotificationType,
    event: WatcherNotification,
  ): void {
    for (const [address, watcher] of this.registry.entries()) {
      const name = this.subscriptionNames.get(address);
      watcher.emit(
        eventType,
        name !== undefined ? { ...event, name } : event
      );
    }

    for (const [id, { watcher }] of this.contractRegistry.entries()) {
      const name = this.subscriptionNames.get(id);
      watcher.emit(
        eventType,
        name !== undefined ? { ...event, name } : event
      );
    }
  }

  private handleCursorFailure(err: unknown): void {
    this.consecutiveCursorFailures++;
    this.log.warn("[pulse-core] cursorStore.set() failed.", {
      key: this.streamKey,
      consecutiveFailures: this.consecutiveCursorFailures,
      error: err instanceof Error ? err.message : String(err),
    });
    if (this.consecutiveCursorFailures >= this.cursorFailureThreshold) {
      this.isCursorStoreUnhealthy = true;
      this.notifyWatchers("engine.cursor_store_unhealthy", {
        type: "engine.cursor_store_unhealthy",
        attempt: 0,
        emittedAt: new Date().toISOString(),
      });
    }
  }

  private describeSubscription(key: string): string {
    const name = this.subscriptionNames.get(key);
    return name !== undefined ? `${name} (${key})` : `address ${key}`;
  }

  private normalize(record: unknown): NormalizedEventOrPending | null {
    const r = record as Record<string, unknown>;

    if (r.type === "payment") {
      const requiredFields = ["to", "from", "amount", "created_at"] as const;
      for (const field of requiredFields) {
        if (typeof r[field] !== "string" || r[field] === "") {
          this.log.warn("[pulse-core] normalize() dropping payment record.", {
            field,
            record,
            source: r.from,
            address: r.to,
          });
          return null;
        }
      }

      const asset =
        r.asset_type === "native" ? "XLM" : `${r.asset_code}:${r.asset_issuer}`;

      return {
        // Route resolution assigns the payment direction after normalization.
        type: "unknown",
        to: toAccountAddress(r.to as string),
        from: toAccountAddress(r.from as string),
        amount: r.amount as string,
        asset,
        timestamp: r.created_at as string,
        raw: record,
      };
    }

    if (r.type === "set_options") {
      return this.normalizeSetOptions(r, record);
    }

    if (r.type === "create_account") {
      return this.normalizeCreateAccount(r, record);
    }

    if (r.type === "manage_sell_offer" || r.type === "manage_buy_offer") {
      return this.normalizeOffer(r, record);
    }

    if (r.type === "bump_sequence") {
      return this.normalizeBumpSequence(r, record);
    }

    if (r.type === "manage_data") {
      return this.normalizeManageData(r, record);
    }

    if (r.type === "change_trust") {
      return this.normalizeChangeTrust(r, record);
    }

    if (r.type === "account_merge") {
      return {
        type: "account.merged",
        source: toAccountAddress(r.account as string),
        destination: toAccountAddress(r.into as string),
        timestamp: r.created_at as string,
        raw: record,
      };
    }

    if (r.type === "create_claimable_balance") {
      return this.normalizeCreateClaimableBalance(r, record);
    }

    if (r.type === "claim_claimable_balance") {
      return this.normalizeClaimClaimableBalance(r, record);
    }

    if (r.type === "liquidity_pool_deposit") {
      return this.normalizeLiquidityPoolDeposit(r, record);
    }

    if (r.type === "liquidity_pool_withdraw") {
      return this.normalizeLiquidityPoolWithdraw(r, record);
    }

    if (r.type === "allow_trust") {
      return this.normalizeAllowTrust(r, record);
    }

    if (r.type === "set_trust_line_flags") {
      return this.normalizeSetTrustLineFlags(r, record);
    }

    if (r.type === "contract_invocation") {
      return this.normalizeContractInvoked(r, record);
    }

    if (r.type === "contract_event") {
      return this.normalizeContractEmitted(r, record);
    }

    return null;
  }

  private normalizeOffer(
    r: Record<string, unknown>,
    raw: unknown,
  ): OfferEvent | null {
    if (
      typeof r.source_account !== "string" ||
      typeof r.created_at !== "string"
    ) {
      return null;
    }

    const offer_id = String(r.offer_id ?? "0");
    const amount = String(r.amount ?? "0");

    let type: OfferEventType;
    if (amount === "0" || amount === "0.0000000") {
      type = "offer.deleted";
    } else if (offer_id === "0") {
      type = "offer.created";
    } else {
      type = "offer.updated";
    }

    const buying_asset =
      r.buying_asset_type === "native"
        ? "XLM"
        : `${r.buying_asset_code as string}:${r.buying_asset_issuer as string}`;

    const selling_asset =
      r.selling_asset_type === "native"
        ? "XLM"
        : `${r.selling_asset_code as string}:${r.selling_asset_issuer as string}`;

    return {
      type,
      offer_id,
      source: toAccountAddress(r.source_account),
      buying_asset,
      selling_asset,
      amount,
      price: r.price as string,
      timestamp: r.created_at,
      raw,
    };
  }

  private normalizeCreateAccount(
    r: Record<string, unknown>,
    raw: unknown,
  ): AccountCreatedEvent | null {
    if (
      typeof r.funder !== "string" ||
      typeof r.account !== "string" ||
      typeof r.starting_balance !== "string" ||
      typeof r.created_at !== "string"
    ) {
      return null;
    }
    return {
      type: "account.created",
      funder: toAccountAddress(r.funder),
      account: toAccountAddress(r.account),
      starting_balance: r.starting_balance,
      timestamp: r.created_at,
      raw,
    };
  }

  private normalizeBumpSequence(
    r: Record<string, unknown>,
    raw: unknown,
  ): BumpSequenceEvent | null {
    if (
      typeof r.source_account !== "string" ||
      typeof r.created_at !== "string"
    ) {
      return null;
    }
    return {
      type: "account.bump_sequence",
      source: toAccountAddress(r.source_account),
      bump_to: r.bump_to as string,
      timestamp: r.created_at,
      raw,
    };
  }

  private normalizeManageData(
    r: Record<string, unknown>,
    raw: unknown,
  ): DataEvent | null {
    if (typeof r.source_account !== "string" || r.source_account === "") {
      this.log.warn("[pulse-core] normalize() dropping manage_data record.", {
        field: "source_account",
        record: raw,
      });
      return null;
    }

    if (typeof r.data_name !== "string" || r.data_name === "") {
      this.log.warn("[pulse-core] normalize() dropping manage_data record.", {
        field: "data_name",
        record: raw,
        source: r.source_account,
      });
      return null;
    }

    const value = r.data_value == null ? null : String(r.data_value);
    const type: DataEventType = value !== null ? "data.set" : "data.cleared";

    let decoded: Uint8Array | null = null;
    if (value !== null) {
      try {
        decoded = Buffer.from(value, "base64");
      } catch (err) {
        decoded = null;
      }
    }

    return {
      type,
      source: toAccountAddress(r.source_account),
      name: r.data_name,
      value,
      decoded,
      timestamp: typeof r.created_at === "string" ? r.created_at : "",
      raw,
    };
  }

  private normalizeChangeTrust(
    r: Record<string, unknown>,
    raw: unknown,
  ): TrustlineEvent | null {
    if (typeof r.source_account !== "string") {
      return null;
    }

    if (typeof r.created_at !== "string") {
      return null;
    }

    if (typeof r.limit !== "string" && typeof r.limit !== "number") {
      return null;
    }

    const asset =
      r.asset_type === "native"
        ? "XLM"
        : `${r.asset_code as string}:${r.asset_issuer as string}`;
    const limit = String(r.limit);

    return {
      type: this.resolveTrustlineEventType(limit),
      account: toAccountAddress(r.source_account),
      asset,
      limit,
      timestamp: r.created_at,
      raw,
    };
  }

  private resolveTrustlineEventType(limit: string): TrustlineEventType {
    if (this.isZeroTrustlineLimit(limit)) {
      return "trustline.removed";
    }

    if (limit === STELLAR_MAX_TRUSTLINE_LIMIT) {
      return "trustline.added";
    }

    return "trustline.updated";
  }

  private isZeroTrustlineLimit(limit: string): boolean {
    return /^0(?:\.0+)?$/.test(limit);
  }

  private normalizeSetOptions(
    r: Record<string, unknown>,
    raw: unknown,
  ): AccountOptionsEvent | null {
    const changes: AccountOptionsChanges = {};

    if (typeof r.signer_key === "string") {
      const weight = typeof r.signer_weight === "number" ? r.signer_weight : 0;
      if (weight === 0) {
        changes.signer_removed = { key: toAccountAddress(r.signer_key), weight: 0 };
      } else {
        changes.signer_added = { key: toAccountAddress(r.signer_key), weight };
      }
    }

    const thresholds: NonNullable<AccountOptionsChanges["thresholds"]> = {};
    if (typeof r.low_threshold === "number")
      thresholds.low_threshold = r.low_threshold;
    if (typeof r.med_threshold === "number")
      thresholds.med_threshold = r.med_threshold;
    if (typeof r.high_threshold === "number")
      thresholds.high_threshold = r.high_threshold;
    if (typeof r.master_key_weight === "number")
      thresholds.master_key_weight = r.master_key_weight;
    if (Object.keys(thresholds).length > 0) changes.thresholds = thresholds;

    if (typeof r.home_domain === "string") {
      changes.home_domain = r.home_domain;
    }

    // set_flags, clear_flags, and inflation_dest are intentionally not tracked — operations
    // that only modify those fields are dropped as no-ops.
    if (Object.keys(changes).length === 0) return null;

    return {
      type: "account.options_changed",
      source: toAccountAddress(r.source_account as string),
      changes,
      timestamp: r.created_at as string,
      raw,
    };
  }

  private normalizeCreateClaimableBalance(
    r: Record<string, unknown>,
    raw: unknown,
  ): ClaimableCreatedEvent | null {
    const requiredStringFields = [
      "source_account",
      "created_at",
      "amount",
      "balance_id",
    ] as const;

    for (const field of requiredStringFields) {
      if (typeof r[field] !== "string" || r[field] === "") {
        this.log.warn(
          "[pulse-core] normalize() dropping create_claimable_balance record.",
          { field, record: raw, source: r.source_account }
        );
        return null;
      }
    }

    if (
      !Array.isArray(r.claimants) ||
      r.claimants.length === 0 ||
      !r.claimants.every(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as Record<string, unknown>).destination === "string" &&
          (c as Record<string, unknown>).destination !== "",
      )
    ) {
      this.log.warn(
        "[pulse-core] normalize() dropping create_claimable_balance record.",
        { field: "claimants", record: raw, source: r.source_account }
      );
      return null;
    }

    const asset =
      r.asset_type === "native" ? "XLM" : `${r.asset_code}:${r.asset_issuer}`;

    return {
      type: "claimable.created",
      sponsor: toAccountAddress(r.source_account as string),
      balanceId: r.balance_id as string,
      claimants: (r.claimants as Array<Record<string, unknown>>).map((c) => ({
        destination: toAccountAddress(c.destination as string),
        predicate: c.predicate,
      })),
      asset,
      amount: r.amount as string,
      timestamp: r.created_at as string,
      raw,
    };
  }

  private normalizeClaimClaimableBalance(
    r: Record<string, unknown>,
    raw: unknown,
  ): ClaimableClaimedEvent | null {
    const requiredStringFields = [
      "source_account",
      "created_at",
      "balance_id",
    ] as const;

    for (const field of requiredStringFields) {
      if (typeof r[field] !== "string" || r[field] === "") {
        this.log.warn(
          "[pulse-core] normalize() dropping claim_claimable_balance record.",
          { field, record: raw, source: r.source_account }
        );
        return null;
      }
    }

    return {
      type: "claimable.claimed",
      claimant: toAccountAddress(r.source_account as string),
      balanceId: r.balance_id as string,
      timestamp: r.created_at as string,
      raw,
    };
  }

  private normalizeLiquidityPoolDeposit(
    r: Record<string, unknown>,
    raw: unknown,
  ): LiquidityPoolDepositEvent | null {
    const requiredFields = [
      "source_account",
      "created_at",
      "liquidity_pool_id",
      "shares_received",
    ] as const;

    for (const field of requiredFields) {
      if (typeof r[field] !== "string" || r[field] === "") {
        this.log.warn(
          "[pulse-core] normalize() dropping liquidity_pool_deposit record.",
          { field, record: raw, source: r.source_account }
        );
        return null;
      }
    }

    if (!Array.isArray(r.reserves_deposited)) {
      this.log.warn(
        "[pulse-core] normalize() dropping liquidity_pool_deposit record.",
        { field: "reserves_deposited", record: raw, source: r.source_account }
      );
      return null;
    }

    return {
      type: "lp.deposited",
      source: toAccountAddress(r.source_account as string),
      pool_id: r.liquidity_pool_id as string,
      reserves_deposited: r.reserves_deposited as LiquidityPoolReserve[],
      shares_received: r.shares_received as string,
      timestamp: r.created_at as string,
      raw,
    };
  }

  private normalizeLiquidityPoolWithdraw(
    r: Record<string, unknown>,
    raw: unknown,
  ): LiquidityPoolWithdrawEvent | null {
    const requiredFields = [
      "source_account",
      "created_at",
      "liquidity_pool_id",
      "shares",
    ] as const;

    for (const field of requiredFields) {
      if (typeof r[field] !== "string" || r[field] === "") {
        this.log.warn(
          "[pulse-core] normalize() dropping liquidity_pool_withdraw record.",
          { field, record: raw, source: r.source_account }
        );
        return null;
      }
    }

    if (!Array.isArray(r.reserves_received)) {
      this.log.warn(
        "[pulse-core] normalize() dropping liquidity_pool_withdraw record.",
        { field: "reserves_received", record: raw, source: r.source_account }
      );
      return null;
    }

    return {
      type: "lp.withdrawn",
      source: toAccountAddress(r.source_account as string),
      pool_id: r.liquidity_pool_id as string,
      reserves_received: r.reserves_received as LiquidityPoolReserve[],
      shares_redeemed: r.shares as string,
      timestamp: r.created_at as string,
      raw,
    };
  }

  private normalizeAllowTrust(
    r: Record<string, unknown>,
    raw: unknown,
  ): TrustAuthEvent | null {
    const trustor = r.trustor;
    const issuer = r.trustee ?? r.source_account;
    const authorize = r.authorize;

    if (typeof trustor !== "string" || trustor === "") return null;
    if (typeof issuer !== "string" || issuer === "") return null;
    if (typeof authorize !== "boolean") return null;
    if (typeof r.created_at !== "string") return null;

    const asset =
      r.asset_type === "native" ? "XLM" : `${r.asset_code}:${r.asset_issuer}`;

    const type: TrustAuthEventType = authorize
      ? "trustline.authorized"
      : "trustline.deauthorized";

    return {
      type,
      trustor: toAccountAddress(trustor),
      issuer: toAccountAddress(issuer),
      asset,
      timestamp: r.created_at,
      operation: "allow_trust",
      raw,
    };
  }

  private normalizeSetTrustLineFlags(
    r: Record<string, unknown>,
    raw: unknown,
  ): TrustAuthEvent | null {
    const trustor = r.trustor;
    const issuer = r.source_account;

    if (typeof trustor !== "string" || trustor === "") return null;
    if (typeof issuer !== "string" || issuer === "") return null;
    if (typeof r.created_at !== "string") return null;

    const setFlagsS = r.set_flags_s as string[] | undefined;
    const clearFlagsS = r.clear_flags_s as string[] | undefined;

    const isSettingAuth = setFlagsS?.includes("authorized") ?? false;
    const isClearingAuth = clearFlagsS?.includes("authorized") ?? false;

    if (isSettingAuth === isClearingAuth) return null;

    const type: TrustAuthEventType = isSettingAuth
      ? "trustline.authorized"
      : "trustline.deauthorized";

    const asset =
      r.asset_type === "native" ? "XLM" : `${r.asset_code}:${r.asset_issuer}`;

    return {
      type,
      trustor: toAccountAddress(trustor),
      issuer: toAccountAddress(issuer),
      asset,
      timestamp: r.created_at,
      operation: "set_trust_line_flags",
      raw,
    };
  }

  private normalizeContractInvoked(
    r: Record<string, unknown>,
    raw: unknown
  ): ContractInvokedEvent | null {
    if (typeof r.contract_id !== "string" || r.contract_id === "") return null;
    if (typeof r.function !== "string") return null;
    if (typeof r.ledger !== "number") return null;
    if (typeof r.txHash !== "string") return null;
    if (typeof r.created_at !== "string") return null;
    return {
      type: "contract.invoked",
      contractId: toContractAddress(r.contract_id),
      function: r.function,
      args: Array.isArray(r.args) ? (r.args as unknown[]) : [],
      ledger: r.ledger,
      txHash: r.txHash,
      timestamp: r.created_at,
      raw,
    };
  }

  private normalizeContractEmitted(
    r: Record<string, unknown>,
    raw: unknown
  ): ContractEmittedEvent | null {
    if (typeof r.contract_id !== "string" || r.contract_id === "") return null;
    if (typeof r.ledger !== "number") return null;
    if (typeof r.eventId !== "string") return null;
    if (typeof r.txHash !== "string") return null;
    if (typeof r.created_at !== "string") return null;
    return {
      type: "contract.emitted",
      contractId: toContractAddress(r.contract_id),
      topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
      data: r.data ?? null,
      decodedData: r.decodedData,
      ledger: r.ledger,
      eventId: r.eventId,
      txHash: r.txHash,
      inSuccessfulContractCall: Boolean(r.inSuccessfulContractCall),
      timestamp: r.created_at,
      raw,
    };
  }

  private passesFilter(address: string, event: NormalizedEvent): boolean {
    const filter = this.filters.get(address);
    if (!filter) return true;

    try {
      return filter(event);
    } catch (err) {
      this.log.warn(
        `[pulse-core] subscribe() filter threw for address ${address} — treating as reject.`,
        err as Record<string, unknown>
      );
      return false;
    }
  }

  private matchesContractFilters(
    event: { type: string; contractId: ContractAddress; topics: string[] },
    filters: ContractSubscriptionFilter[]
  ): boolean {
    // No filters = match everything
    if (filters.length === 0) return true;

    // At least one filter must match (OR across filters)
    return filters.some((f) => {
      if (f.type !== undefined && f.type !== event.type) return false;
      if (f.contractIds !== undefined && !f.contractIds.includes(event.contractId)) return false;
      if (f.topicFilters !== undefined) {
        // Only ContractEmittedEvent has topics
        if (event.type === "contract.emitted") {
          for (let i = 0; i < f.topicFilters.length; i++) {
            const pattern = f.topicFilters[i];
            if (pattern !== null && pattern !== event.topics[i]) return false;
          }
        } else {
          // ContractInvokedEvent doesn't have topics, so topicFilters don't apply
          return false;
        }
      }
      return true;
    });
  }

  /** Dispatch a contract event (invoked or emitted) to all matching contract watchers. */
  private dispatchContractEvent(event: ContractInvokedEvent | ContractEmittedEvent): void {
    for (const { watcher, filters } of this.contractRegistry.values()) {
      if (this.matchesContractFilters(event, filters)) {
        watcher.emit(event.type, event);
        watcher.emit("*", event);
      }
    }
  }

  private route(event: NormalizedEventOrPending): void {
    // Check if Soroban source is paused for contract events
    if ((event.type === "contract.invoked" || event.type === "contract.emitted") && this.pausedSources.has("soroban")) {
      return;
    }

    // Check if Horizon source is paused for all other events
    if (event.type !== "contract.invoked" && event.type !== "contract.emitted" && this.pausedSources.has("horizon")) {
      return;
    }

    if (event.type === "account.created") {
      const funderWatcher = this.registry.get(event.funder);
      if (funderWatcher && this.passesFilter(event.funder, event)) {
        funderWatcher.emit("account.created", event);
        funderWatcher.emit("*", event);
      }

      const accountWatcher = this.registry.get(event.account);
      if (
        accountWatcher &&
        event.account !== event.funder &&
        this.passesFilter(event.account, event)
      ) {
        accountWatcher.emit("account.created", event);
        accountWatcher.emit("*", event);
      }
      return;
    }

    if (event.type === "account.options_changed") {
      const watcher = this.registry.get(event.source);
      if (watcher && this.passesFilter(event.source, event)) {
        watcher.emit("account.options_changed", event);
        watcher.emit("*", event);
      }
      return;
    }

    if (
      event.type === "offer.created" ||
      event.type === "offer.updated" ||
      event.type === "offer.deleted"
    ) {
      const watcher = this.registry.get(event.source);
      if (watcher && this.passesFilter(event.source, event)) {
        watcher.emit(event.type, event);
        watcher.emit("*", event);
      }
      return;
    }

    if (
      event.type === "trustline.added" ||
      event.type === "trustline.removed" ||
      event.type === "trustline.updated"
    ) {
      const watcher = this.registry.get(event.account);
      if (watcher && this.passesFilter(event.account, event)) {
        watcher.emit(event.type, event);
        watcher.emit("*", event);
      }
      return;
    }

    if (event.type === "account.merged") {
      const sourceWatcher = this.registry.get(event.source);
      if (sourceWatcher && this.passesFilter(event.source, event)) {
        sourceWatcher.emit("account.merged", event);
        sourceWatcher.emit("*", event);
      }

      const destinationWatcher = this.registry.get(event.destination);
      if (destinationWatcher && this.passesFilter(event.destination, event)) {
        destinationWatcher.emit("account.merged", event);
        destinationWatcher.emit("*", event);
      }
      return;
    }

    if (event.type === "account.bump_sequence") {
      const watcher = this.registry.get(event.source);
      if (watcher && this.passesFilter(event.source, event)) {
        watcher.emit("account.bump_sequence", event);
        watcher.emit("*", event);
      }
      return;
    }

    if (event.type === "data.set" || event.type === "data.cleared") {
      const watcher = this.registry.get(event.source);
      if (watcher && this.passesFilter(event.source, event)) {
        watcher.emit(event.type, event);
        watcher.emit("*", event);
      }
      return;
    }

    if (event.type === "claimable.created") {
      const notified = new Set<string>();

      for (const claimant of event.claimants) {
        const watcher = this.registry.get(claimant.destination);
        if (
          watcher &&
          !notified.has(claimant.destination) &&
          this.passesFilter(claimant.destination, event)
        ) {
          notified.add(claimant.destination);
          watcher.emit("claimable.created", event);
          watcher.emit("*", event);
        }
      }

      if (!notified.has(event.sponsor)) {
        const sponsorWatcher = this.registry.get(event.sponsor);
        if (sponsorWatcher && this.passesFilter(event.sponsor, event)) {
          sponsorWatcher.emit("claimable.created", event);
          sponsorWatcher.emit("*", event);
        }
      }
      return;
    }

    if (event.type === "claimable.claimed") {
      const watcher = this.registry.get(event.claimant);
      if (watcher && this.passesFilter(event.claimant, event)) {
        watcher.emit("claimable.claimed", event);
        watcher.emit("*", event);
      }
      return;
    }

    if (event.type === "lp.deposited" || event.type === "lp.withdrawn") {
      const watcher = this.registry.get(event.source);
      if (watcher && this.passesFilter(event.source, event)) {
        watcher.emit(event.type, event);
        watcher.emit("*", event);
      }
      return;
    }

    if (
      event.type === "trustline.authorized" ||
      event.type === "trustline.deauthorized"
    ) {
      const issuerWatcher = this.registry.get(event.issuer);
      if (issuerWatcher && this.passesFilter(event.issuer, event)) {
        issuerWatcher.emit(event.type, event);
        issuerWatcher.emit("*", event);
      }

      const trustorWatcher = this.registry.get(event.trustor);
      if (
        trustorWatcher &&
        event.trustor !== event.issuer &&
        this.passesFilter(event.trustor, event)
      ) {
        trustorWatcher.emit(event.type, event);
        trustorWatcher.emit("*", event);
      }
      return;
    }

    if (event.type === "contract.invoked" || event.type === "contract.emitted") {
      if (event.type === "contract.emitted" && this.abiRegistry) {
        // Async enrichment: look up the ABI spec and populate decodedData,
        // then route. The event is held until the lookup settles so that
        // subscribers always receive a fully-enriched (or gracefully degraded)
        // event rather than a partially-populated one.
        const contractId = event.contractId;
        this.abiRegistry.getSpec(contractId).then(
          (spec) => {
            if (spec !== null && spec !== undefined) {
              (event as ContractEmittedEvent).decodedData = (spec as { entries?: unknown }).entries ?? spec;
            }
            this.dispatchContractEvent(event);
          },
          (err: unknown) => {
            this.log.warn("ABI registry lookup failed for contract.emitted event", {
              contractId,
              error: err instanceof Error ? err.message : String(err),
            });
            this.dispatchContractEvent(event);
          }
        );
        return;
      }

      this.dispatchContractEvent(event);
      return;
    }

    if (event.type !== "unknown") {
      return;
    }

    if (event.from === event.to) {
      const watcher = this.registry.get(event.to);
      if (watcher) {
        const selfPayment = this.withResolvedType(event, "payment.self");
        if (this.passesFilter(event.to, selfPayment)) {
          watcher.emit("payment.self", selfPayment);
          watcher.emit("*", selfPayment);
        }
      }
      return;
    }

    const toWatcher = this.registry.get(event.to);
    if (toWatcher) {
      const receivedEvent = this.withResolvedType(event, "payment.received");
      if (this.passesFilter(event.to, receivedEvent)) {
        toWatcher.emit("payment.received", receivedEvent);
        toWatcher.emit("*", receivedEvent);
      }
    }

    const fromWatcher = this.registry.get(event.from);
    if (fromWatcher) {
      const sentEvent = this.withResolvedType(event, "payment.sent");
      if (this.passesFilter(event.from, sentEvent)) {
        fromWatcher.emit("payment.sent", sentEvent);
        fromWatcher.emit("*", sentEvent);
      }
    }
  }

  private withResolvedType(
    event: PendingPaymentEvent,
    type: PaymentEventType,
  ): PaymentEvent {
    return {
      ...event,
      type,
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy Soroban RPC normalizer
//
// Normalizes a raw Soroban RPC event object (as returned by the RPC
// `getEvents` endpoint) into a typed result.  This is a lower-level utility
// that operates on the raw RPC shape rather than the Horizon-derived
// NormalizedEvent union used by EventEngine internally.
// ---------------------------------------------------------------------------

/** @internal */
export interface RpcContractInvokedEvent {
  // export interface SorobanContractInvokedEvent {
  type: "contract_invoked";
  id: string;
  pagingToken: string;
  contractId: string;
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  inSuccessfulContractCall: boolean;
  raw: unknown;
}

/** @internal */
export interface RpcContractEmittedEvent {
  // export interface SorobanContractEmittedEvent {
  type: "contract_emitted";
  id: string;
  pagingToken: string;
  contractId: string;
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  topics: string[];
  value: string;
  inSuccessfulContractCall: boolean;
  raw: unknown;
}

/**
 * Normalizes a raw Soroban RPC event into a typed domain event structure.
 * Handles malformed fields safely by logging warnings and returning null.
 */
export function normalizeContractEvent(
  rawRpcEvent: any
): RpcContractInvokedEvent | RpcContractEmittedEvent | null {
  // export function normalizeContractEvent(rawRpcEvent: any): SorobanContractInvokedEvent | SorobanContractEmittedEvent | null {
  // 1. Structural check patterns
  if (!rawRpcEvent || typeof rawRpcEvent !== "object") {
    console.warn(
      "[pulse-core] Dropping malformed Soroban event: payload is not a valid object.",
      rawRpcEvent
    );
    return null;
  }

  const e = rawRpcEvent as Record<string, unknown>;

  const requiredFields = [
    "id",
    "pagingToken",
    "contractId",
    "txHash",
    "ledger",
    "ledgerClosedAt",
    "type",
  ];
  for (const field of requiredFields) {
    if (e[field] === undefined || e[field] === null) {
      console.warn(
        `[pulse-core] Dropping malformed Soroban event: missing required field "${field}".`,
        rawRpcEvent
      );
      return null;
    }
  }

  const {
    contractId,
    txHash,
    ledger,
    type,
    inSuccessfulContractCall,
    topic,
    value,
  } = e;

  if (type === "system" || type === "diagnostic") {
    if (typeof rawRpcEvent.function !== "string") {
      console.warn("[pulse-core] Dropping malformed contract invoked event: missing function field.", rawRpcEvent);
      return null;
    }
    return {
      type: "contract.invoked",
      contractId: String(contractId),
      function: String(rawRpcEvent.function),
      args: Array.isArray(rawRpcEvent.args) ? (rawRpcEvent.args as unknown[]) : [],
      txHash: String(txHash),
      ledger: Number(ledger),
      timestamp: typeof created_at === "string" ? created_at : new Date().toISOString(),
      raw: rawRpcEvent,
    };
  }

  if (type === "contract") {
    if (!Array.isArray(topic) || value === undefined || value === null) {
      console.warn(
        "[pulse-core] Dropping malformed contract emitted event: missing topics array or data payload.",
        rawRpcEvent
      );
      return null;
    }

    return {
      type: "contract.emitted",
      contractId: String(contractId),
      txHash: String(txHash),
      ledger: Number(ledger),
      ledgerClosedAt: String(ledgerClosedAt),
      topics: (topic as unknown[]).map((t) => String(t)),
      value: String(value),
      inSuccessfulContractCall: Boolean(inSuccessfulContractCall),
      raw: rawRpcEvent,
    };
  }

  console.warn(
    `[pulse-core] Dropping malformed Soroban event: unknown event type category "${type}".`,
    rawRpcEvent
  );
  return null;
}
