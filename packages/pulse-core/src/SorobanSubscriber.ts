import type { ContractAddress, ContractSubscriptionFilter } from "./index.js";
import type { CursorStore, SorobanCursorStore, SorobanRpc } from "./index.js";
import type { Logger } from "./index.js";
import { SorobanRpcError } from "./errors.js";

/**
 * SorobanSubscriber — polls a Soroban RPC for contract events and forwards
 * them to a caller-supplied handler.
 *
 * CursorStore integration (Issue #296)
 * ------------------------------------
 * - Uses `streamKey` when provided.
 * - On `pollOnce()` it calls `cursorStore.get(streamKey)` and starts from that
 *   cursor when present.
 * - After each successfully delivered event it calls
 *   `cursorStore.set(streamKey, cursor)`.
 * - `cursorStore.set()` failures are tolerated with a warn log; delivery is
 *   never blocked.
 */

export type SorobanEvent = {
  id: string;
  pagingToken: string;
  topic: string[];
  value: unknown;
  contractId?: ContractAddress;
  txHash?: string;
  ledger?: number;
  timestamp?: string;
  decodedData?: unknown;
};

export type SorobanSubscriberOptions = {
  rpc: SorobanRpc;
  cursorStore: SorobanCursorStore;
  streamKey: string;
  onEvent: (event: SorobanEvent) => Promise<void>;
  filters?: ContractSubscriptionFilter[];
  pageLimit?: number;
  pollIntervalMs?: number;
  endLedger?: number;
  onDone?: () => void;
  logger?: Logger;
};

export class SorobanSubscriber {
  private readonly rpc: SorobanRpc;
  private readonly cursorStore: SorobanCursorStore;
  private readonly streamKey: string;
  private readonly onEvent: (event: SorobanEvent) => Promise<void>;
  private readonly filters: ContractSubscriptionFilter[];
  private readonly pageLimit: number;
  private readonly logger: Required<Pick<Logger, "warn" | "info" | "error">>;

  private stopped = false;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inflightPoll: Promise<void> | null = null;
  private inflightAbort: AbortController | null = null;

  private replayDone = false;
  private replayCursor: string | undefined;

  constructor(options: SorobanSubscriberOptions) {
    this.rpc = options.rpc;
    this.cursorStore = options.cursorStore;
    this.streamKey = options.streamKey;
    this.onEvent = options.onEvent;
    this.filters = options.filters ?? [];
    this.pageLimit = options.pageLimit ?? 100;
    const log = options.logger;
    this.logger = {
      info: log?.info ?? (() => {}),
      warn: log?.warn ?? (() => {}),
      error: log?.error ?? (() => {}),
    };
    this.replayCursor = undefined;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.pollOnce();

    const intervalMs = 2000;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    if (this.pollTimer && typeof (this.pollTimer as any).unref === "function") {
      (this.pollTimer as any).unref();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.inflightAbort?.abort();
    if (this.inflightPoll) {
      await this.inflightPoll;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.stopped) return;

    const abort = new AbortController();
    this.inflightAbort = abort;
    const poll = this._poll(abort.signal);
    this.inflightPoll = poll;
    try {
      await poll;
    } finally {
      if (this.inflightPoll === poll) this.inflightPoll = null;
      if (this.inflightAbort === abort) this.inflightAbort = null;
    }
  }

  private async _poll(signal: AbortSignal): Promise<void> {
    const durableCursor = await this.cursorStore.get(this.streamKey);
    const startCursor = this.replayCursor ?? durableCursor ?? undefined;

    const result = await this.rpc.getEvents(startCursor, this.pageLimit, signal);

    if (this.stopped) return;

    for (const event of result.events) {
      if (this.stopped) return;
      await this.onEvent(event);

      // Update cursor after successful delivery.
      try {
        await this.cursorStore.set(this.streamKey, event.pagingToken);
      } catch (err) {
        this.logger.warn("[pulse-core] Soroban cursorStore.set() failed", {
          streamKey: this.streamKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      this.replayCursor = event.pagingToken;
    }
  }

  // Placeholder for compatibility with existing code paths.
  // Real Soroban contract filter matching is done within RPC response.
  private matchesFilters(_event: SorobanEvent): boolean {
    if (this.filters.length === 0) return true;
    return true;
  }
}

