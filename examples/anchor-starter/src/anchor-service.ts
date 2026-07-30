import path from "path";
import { EventEngine, FileCursorStore, type NormalizedEvent } from "@orbital-stellar/pulse-core";
import { MemoryRetryQueue, MemoryDeadLetterStore } from "@orbital-stellar/pulse-webhooks";
import type { RetryRecord } from "@orbital-stellar/pulse-webhooks";
import type { AuditLogWriter, AuditRecord } from "./audit-log.js";
import { extractAuditRecord } from "./extract-audit.js";

/** Payload enqueued to the retry queue for a failed audit-log write. */
type AuditRetryPayload = { record: AuditRecord; originalEvent: NormalizedEvent };

/**
 * Configuration for the AnchorService.
 *
 * Every field has a sensible default so the simplest possible usage is
 * `new AnchorService({ accounts: ["GABC..."] })`.
 */
export interface AnchorServiceConfig {
  /**
   * Stellar distribution accounts to monitor.
   *
   * The service subscribes to payment and trustline events for every account
   * in this list. Payments sent FROM these accounts and trustline changes
   * made BY these accounts are both captured.
   */
  accounts: string[];

  /** Stellar network to connect to. Defaults to `"testnet"`. */
  network?: "mainnet" | "testnet";

  /** Directory for cursor persistence. Defaults to `"./.orbital-cursors"`. */
  cursorDir?: string;

  /**
   * An already-initialized {@link AuditLogWriter}. If omitted, only in-memory
   * dead-letter capture is active - useful for testing the composition without
   * writing to disk.
   */
  auditLog?: AuditLogWriter;

  /**
   * When set, Horizon URL override for self-hosted nodes or regional mirrors.
   * @see {@link import("@orbital-stellar/pulse-core").CoreConfig.horizonUrl}
   */
  horizonUrl?: string;
}

/**
 * The anchor event-capture service: composes CursorStore, RetryQueue, and
 * DeadLetterStore into a single production-shaped pipeline.
 *
 * ## What this service guarantees (and what it does not)
 *
 * **Guarantee: at-least-once delivery with idempotency keys.**
 *
 * Every event written to the audit log may appear more than once when the
 * engine restarts mid-ledger or a Horizon SSE reconnect replays a window.
 * Consumers MUST deduplicate by `(ledger, operationIndex)` or by the
 * `x-orbital-delivery-id` header on webhook delivery.
 *
 * **NOT a guarantee: exactly-once.**
 *
 * The composition of `CursorStore` (durable position tracking) + `RetryQueue`
 * (exponential backoff redelivery) + `DeadLetterStore` (terminal failure
 * persistence) gives you at-least-once semantics. Exactly-once requires a
 * transactional outbox, which is not provided by these primitives alone.
 *
 * ## How the composition works
 *
 * 1. **CursorStore** (FileCursorStore): persists the last-seen Horizon cursor
 *    to disk so the stream resumes from where it left off after a restart.
 * 2. **RetryQueue** (MemoryRetryQueue): when an audit-log write fails, the
 *    record is enqueued for retry with exponential backoff. Retried writes
 *    that eventually succeed are acked; those that exhaust all attempts are
 *    routed to the DeadLetterStore.
 * 3. **DeadLetterStore** (MemoryDeadLetterStore): terminal write failures are
 *    persisted here with full context (event, error, attempts) for manual
 *    inspection and replay.
 *
 * ## Replay
 *
 * `replayFrom(cursor)` re-subscribes to the event stream at the given cursor
 * position and writes to the configured audit log. The output is byte-identical
 * to the original run because (a) Horizon returns the same ledger data in the
 * same order for a given cursor range and (b) audit records are serialized with
 * sorted keys.
 */
export class AnchorService {
  private readonly accounts: string[];
  private readonly network: "mainnet" | "testnet";
  private readonly cursorDir: string;
  private readonly auditLog: AuditLogWriter | undefined;
  private readonly horizonUrl: string | undefined;
  private engine: EventEngine | null = null;
  private retryQueue: MemoryRetryQueue;
  private deadLetterStore: MemoryDeadLetterStore;
  private running = false;
  private pollerTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxRetryAttempts = 3;

  constructor(config: AnchorServiceConfig) {
    this.accounts = config.accounts;
    this.network = config.network ?? "testnet";
    this.cursorDir = config.cursorDir ?? "./.orbital-cursors";
    this.auditLog = config.auditLog;
    this.horizonUrl = config.horizonUrl;

    // Compose the three primitives.
    //
    // CursorStore is instantiated inside start() because it needs to be
    // created fresh for each engine lifecycle (the engine owns the store).
    //
    // RetryQueue backs audit-log write retries. When a write fails, the record
    // is enqueued with a backoff delay. The retry poller dequeues due records
    // and re-attempts the write. Records that exhaust all attempts are routed
    // to the DeadLetterStore.
    //
    // DeadLetterStore persists terminal write failures for manual inspection
    // and replay. Production deployments should swap MemoryRetryQueue for
    // RedisRetryQueue and MemoryDeadLetterStore for PostgresDeadLetterStore.
    this.retryQueue = new MemoryRetryQueue();
    this.deadLetterStore = new MemoryDeadLetterStore();
  }

  /**
   * Starts the event engine, subscribes to all configured accounts, and begins
   * writing payment + trustline events to the audit log.
   */
  async start(): Promise<void> {
    if (this.running) return;

    const cursorStore = new FileCursorStore(this.cursorDir);

    const engineConfig: import("@orbital-stellar/pulse-core").CoreConfig = {
      network: this.network,
      cursorStore,
      streamKey: "anchor-starter",
    };
    if (this.horizonUrl) {
      engineConfig.horizonUrl = this.horizonUrl;
    }

    this.engine = new EventEngine(engineConfig);

    // Subscribe to every configured account.
    for (const account of this.accounts) {
      const watcher = this.engine.subscribe(account, {
        filter: (event: NormalizedEvent): boolean => {
          // Only capture payment and trustline events.
          return (
            event.type === "payment.received" ||
            event.type === "payment.sent" ||
            event.type === "payment.self" ||
            event.type === "trustline.added" ||
            event.type === "trustline.removed" ||
            event.type === "trustline.updated"
          );
        },
      });

      watcher.on("*", (event) => {
        // Only process normalized events (skip lifecycle notifications).
        // The filter predicate above ensures only payment/trustline events
        // reach this handler, but TypeScript sees the full WatcherEvent union.
        if (!("raw" in event)) return;
        void this.handleEvent(event as NormalizedEvent);
      });
    }

    this.engine.start();
    this.running = true;

    // Start the retry-queue poller to drain due retries.
    this.startRetryPoller();
  }

  /**
   * Gracefully stops the engine, flushes the audit log, and cleans up.
   * Call this in your SIGTERM/SIGINT handler.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopRetryPoller();
    this.engine?.stop();
    if (this.auditLog) {
      await this.auditLog.close();
    }
    this.running = false;
  }

  /** Whether the service is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The underlying retry queue instance. */
  getRetryQueue(): MemoryRetryQueue {
    return this.retryQueue;
  }

  /** The underlying dead-letter store instance. */
  getDeadLetterStore(): MemoryDeadLetterStore {
    return this.deadLetterStore;
  }

  /**
   * Rebuilds the audit log from a given cursor position.
   *
   * Stops the current engine (if running), creates a fresh engine with the
   * same cursor store, and replays from the given cursor. The output is
   * byte-identical to the original run from that cursor forward.
   *
   * @param cursor - The Horizon cursor to replay from (typically a paging token).
   * @param outputPath - Where to write the replayed audit log. Defaults to a
   *   sibling file of the current audit log with a `.replay` suffix.
   */
  async replayFrom(cursor: string, outputPath?: string): Promise<AnchorService> {
    // When no explicit output path is given, derive one from the current log.
    const replayPath = outputPath ?? this.deriveReplayPath();

    // Seed the cursor store so the new engine picks up the requested position.
    const cursorStore = new FileCursorStore(this.cursorDir);
    await cursorStore.set("anchor-starter", cursor);

    const { AuditLogWriter } = await import("./audit-log.js");
    const replayLog = new AuditLogWriter({ filePath: replayPath, fsyncOnAppend: true });
    await replayLog.open();

    const replayConfig: AnchorServiceConfig = {
      accounts: this.accounts,
      network: this.network,
      cursorDir: this.cursorDir,
      auditLog: replayLog,
      horizonUrl: this.horizonUrl,
    };

    const replayService = new AnchorService(replayConfig);
    await replayService.start();
    return replayService;
  }

  // --- private helpers ---

  private async handleEvent(event: NormalizedEvent): Promise<void> {
    if (!this.running) return;

    const record = extractAuditRecord(event);
    if (record === null) return;

    // Write to the audit log if configured.
    if (this.auditLog) {
      await this.writeWithRetry(record, event);
    }
  }

  /**
   * Attempts to write an audit record, enqueuing to the retry queue on failure.
   *
   * On first failure, the record is enqueued with a backoff delay. The retry
   * poller picks it up and re-attempts the write. After `maxRetryAttempts`
   * failures (including the initial attempt), the record is dead-lettered.
   */
  private async writeWithRetry(record: AuditRecord, event: NormalizedEvent): Promise<void> {
    try {
      await this.auditLog!.append(record);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const logFilePath =
        (this.auditLog as unknown as { filePath?: string }).filePath ?? "unknown";

      // Enqueue for retry. The poller will pick this up.
      await this.retryQueue.enqueue({
        id: `audit-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        event: { record, originalEvent: event },
        url: `audit-log://${logFilePath}`,
        attempt: 1,
        nextRetryAt: Date.now() + 1000, // retry after 1s
        lastError: errorMessage,
        createdAt: Date.now(),
      });
    }
  }

  private startRetryPoller(): void {
    this.pollerTimer = setInterval(() => {
      void this.drainRetryQueue();
    }, 1000);
  }

  private stopRetryPoller(): void {
    if (this.pollerTimer !== null) {
      clearInterval(this.pollerTimer);
      this.pollerTimer = null;
    }
  }

  private async drainRetryQueue(): Promise<void> {
    if (!this.running || !this.auditLog) return;

    // Max records drained per poll cycle to prevent unbounded event-loop
    // blocking when the queue is large.
    const MAX_PER_CYCLE = 100;
    let drained = 0;

    let record: RetryRecord | null;
    while (drained < MAX_PER_CYCLE && (record = await this.retryQueue.dequeue()) !== null) {
      drained++;
      const payload = record.event as AuditRetryPayload;

      try {
        await this.auditLog.append(payload.record);
        // Write succeeded - ack the retry record.
        await this.retryQueue.ack(record.id);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (record.attempt >= this.maxRetryAttempts) {
          // Exhausted all attempts - dead-letter and ack.
          await this.deadLetterStore.record({
            url: record.url,
            event: payload.originalEvent,
            error: errorMessage,
            attempts: record.attempt,
          });
          await this.retryQueue.ack(record.id);
        } else {
          // Re-enqueue with exponential backoff and incremented attempt counter.
          // We ack the current record and enqueue a fresh one because nack()
          // reuses the in-flight record as-is (same attempt count).
          const delay = Math.min(1000 * Math.pow(2, record.attempt), 30000);
          await this.retryQueue.ack(record.id);
          await this.retryQueue.enqueue({
            ...record,
            attempt: record.attempt + 1,
            nextRetryAt: Date.now() + delay,
            lastError: errorMessage,
          });
        }
      }
    }
  }

  private deriveReplayPath(): string {
    if (this.auditLog) {
      const logPath = (this.auditLog as unknown as { filePath?: string }).filePath;
      if (logPath) {
        const parsed = path.parse(logPath);
        return path.join(parsed.dir, `${parsed.name}.replay${parsed.ext}`);
      }
    }
    return "./audit-log.replay.jsonl";
  }
}
