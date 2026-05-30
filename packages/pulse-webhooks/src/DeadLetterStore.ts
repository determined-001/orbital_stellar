import type { NormalizedEvent, WatcherNotification, Watcher } from "@orbital/pulse-core";

/**
 * A `webhook.failed` notification as emitted by {@link WebhookDelivery} on the
 * watcher. The terminal-failure metadata lives under `raw`, with the original
 * event preserved in `raw.originalEvent` so it can be replayed verbatim.
 */
export type WebhookFailedNotification = NormalizedEvent & {
  raw: {
    error: string;
    url: string;
    attempts: number;
    originalEvent: NormalizedEvent;
  };
};

/** A persisted dead-letter entry describing a single failed delivery. */
export type DeadLetterRecord = {
  /** Stable identifier for this failure, used as the argument to {@link DeadLetterStore.replay}. */
  failureId: string;
  /** The target URL the delivery was bound for. */
  url: string;
  /** The error message from the final failed attempt. */
  error: string;
  /** Number of delivery attempts made before the event was dead-lettered. */
  attempts: number;
  /** The original event, suitable for re-enqueueing into the retry queue. */
  originalEvent: NormalizedEvent;
  /** ISO timestamp of when the failure was recorded. */
  failedAt: string;
  /** How many times {@link DeadLetterStore.replay} has been invoked for this record. */
  replayCount: number;
};

export type DeadLetterStoreConfig = {
  /**
   * Maximum number of times a single failure may be replayed before
   * {@link DeadLetterStore.replay} refuses, guarding against infinite
   * replay loops (e.g. a downstream that always 500s). Defaults to 3.
   */
  maxReplays?: number;
  /** Override the ID generator. Defaults to a monotonic `dlq_<n>` counter. */
  generateId?: () => string;
  /** Override the clock. Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
};

/**
 * In-memory dead-letter store for {@link WebhookDelivery}.
 *
 * Attach it to a watcher with {@link DeadLetterStore.attach} (or call
 * {@link DeadLetterStore.record} directly) to capture `webhook.failed`
 * notifications. Once a downstream outage is resolved, operators call
 * {@link DeadLetterStore.replay} with a `failureId` to re-enqueue the original
 * event into the delivery pipeline.
 *
 * Replay re-emits the original event on the watcher, so a healthy `WebhookDelivery`
 * attached to the same watcher delivers it through the normal sign → POST → retry
 * path. Each replay is counted; once `maxReplays` is reached the store refuses to
 * replay again, preventing infinite loops against a persistently broken endpoint.
 *
 * @example
 * const dlq = new DeadLetterStore(watcher);
 * // ...after the outage is fixed:
 * for (const { failureId } of dlq.list()) {
 *   await dlq.replay(failureId);
 * }
 */
export class DeadLetterStore {
  private readonly watcher: Watcher;
  private readonly maxReplays: number;
  private readonly generateId: () => string;
  private readonly now: () => string;
  private readonly records: Map<string, DeadLetterRecord> = new Map();
  private idCounter = 0;
  private detach: (() => void) | null = null;

  constructor(watcher: Watcher, config: DeadLetterStoreConfig = {}) {
    this.watcher = watcher;
    this.maxReplays = Math.max(0, config.maxReplays ?? 3);
    this.generateId = config.generateId ?? (() => `dlq_${++this.idCounter}`);
    this.now = config.now ?? (() => new Date().toISOString());
    this.attach();
  }

  /**
   * Subscribes to the watcher's `webhook.failed` events so failures are
   * captured automatically. Called once from the constructor; idempotent.
   * The subscription is torn down when the watcher stops.
   */
  private attach(): void {
    if (this.detach) return;

    const handler = (event: NormalizedEvent | WatcherNotification): void => {
      this.record(event as WebhookFailedNotification);
    };

    this.watcher.on("webhook.failed", handler);
    const removeStopHandler = this.watcher.addStopHandler(() => {
      this.watcher.off("webhook.failed", handler);
    });

    this.detach = () => {
      this.watcher.off("webhook.failed", handler);
      removeStopHandler();
      this.detach = null;
    };
  }

  /**
   * Persists a failed delivery and returns its `failureId`. Normally invoked
   * automatically via the `webhook.failed` subscription, but exposed for
   * callers wiring their own handler or seeding records from durable storage.
   */
  record(notification: WebhookFailedNotification): string {
    const failureId = this.generateId();
    const { error, url, attempts, originalEvent } = notification.raw;

    this.records.set(failureId, {
      failureId,
      url,
      error,
      attempts,
      originalEvent,
      failedAt: this.now(),
      replayCount: 0,
    });

    return failureId;
  }

  /**
   * Re-enqueues the original event behind `failureId` into the retry queue by
   * re-emitting it on the watcher. A healthy `WebhookDelivery` then delivers it
   * through the normal pipeline.
   *
   * @returns `true` if the event was re-enqueued, `false` if the replay cap was
   *   reached (the record is retained so the cap is not silently reset).
   * @throws If no record exists for `failureId`, or the watcher has stopped.
   */
  replay(failureId: string): boolean {
    const record = this.records.get(failureId);
    if (!record) {
      throw new Error(`[pulse-webhooks] No dead-letter record for failureId "${failureId}".`);
    }

    if (this.watcher.stopped) {
      throw new Error(
        `[pulse-webhooks] Cannot replay "${failureId}": the watcher has stopped.`,
      );
    }

    if (record.replayCount >= this.maxReplays) {
      this.watcher.emit("webhook.replay_exhausted", {
        ...record.originalEvent,
        raw: {
          reason: "replay_cap_exceeded",
          failureId,
          url: record.url,
          replayCount: record.replayCount,
          maxReplays: this.maxReplays,
          originalEvent: record.originalEvent,
        },
      } as unknown as NormalizedEvent);
      return false;
    }

    record.replayCount += 1;

    // Re-emit the original event. WebhookDelivery listens on "*", so this
    // re-enters the sign → POST → retry pipeline exactly as a fresh event would.
    this.watcher.emit("*", record.originalEvent);
    return true;
  }

  /** Returns the stored record for `failureId`, or `undefined` if none exists. */
  get(failureId: string): DeadLetterRecord | undefined {
    const record = this.records.get(failureId);
    return record ? { ...record } : undefined;
  }

  /** Returns a snapshot of all stored dead-letter records. */
  list(): DeadLetterRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  /**
   * Removes a record from the store (e.g. after a confirmed-successful replay).
   * @returns `true` if a record was removed.
   */
  delete(failureId: string): boolean {
    return this.records.delete(failureId);
  }

  /** Number of records currently held. */
  get size(): number {
    return this.records.size;
  }

  /** Stops capturing `webhook.failed` events. Retained records are untouched. */
  close(): void {
    this.detach?.();
  }
}
