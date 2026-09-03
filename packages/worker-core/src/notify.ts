import { Watcher } from "@orbital-stellar/pulse-core";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";
import type { WebhookConfig, DeadLetterStore } from "@orbital-stellar/pulse-webhooks";
import type { WorkerEvent, WorkerFiredEvent, WorkerMissedEvent, WorkerFailure } from "./events.js";

/**
 * Configuration for worker webhook notifications.
 */
export type WorkerNotifyConfig = {
  /** Webhook configuration for delivering worker events. Uses the same config shape as pulse-webhooks. */
  webhook: WebhookConfig;
  /**
   * Optional dead-letter store for terminal delivery failures.
   * When omitted, an in-memory store is used.
   */
  deadLetterStore?: DeadLetterStore;
};

/**
 * Tracks pending miss notifications to ensure one-per-window semantics.
 * A miss is only notified once per (workerId, window) pair.
 */
class MissDedupStore {
  private notified = new Set<string>();

  /**
   * Returns true if this (workerId, window) pair has already been notified.
   */
  has(workerId: string, window: string): boolean {
    return this.notified.has(this.key(workerId, window));
  }

  /**
   * Records that a miss notification was sent for this (workerId, window) pair.
   */
  add(workerId: string, window: string): void {
    this.notified.add(this.key(workerId, window));
  }

  /**
   * Clears the dedup store. Call periodically or on shutdown to prevent unbounded growth.
   */
  clear(): void {
    this.notified.clear();
  }

  private key(workerId: string, window: string): string {
    return `${workerId}:${window}`;
  }
}

/**
 * Creates a NormalizedEvent-compatible wrapper around a WorkerEvent
 * so it can be delivered through the pulse-webhooks signing and retry path.
 * Includes a `raw` field so WebhookDelivery picks it up.
 *
 * `NormalizedEvent` is a closed union of pulse-core's own chain-derived event
 * types, and `worker.fired` / `worker.missed` are deliberately not members of
 * it: they describe this package's scheduler, not anything Horizon or Soroban
 * emitted. The two-step cast is the seam between those vocabularies. It is safe
 * because WebhookDelivery only reads the structural fields every branch of the
 * union shares -- `type`, `timestamp`, `timestampDate` and `raw` -- all of which
 * are populated below. Widening the union in pulse-core to admit worker events
 * would make every consumer of `NormalizedEvent` handle cases that can never
 * reach them from a chain source.
 */
function workerEventToNormalized(event: WorkerEvent): NormalizedEvent {
  const base = {
    ...event,
    timestampDate: new Date(event.timestamp),
    raw: { source: "worker-core", ...event },
  };
  return base as unknown as NormalizedEvent;
}

/**
 * Worker notification manager that delivers worker.fired and worker.missed
 * events through the existing pulse-webhooks signing and retry path.
 *
 * Miss notifications fire once per window (not once per retry attempt),
 * using the worker's fire key (workerId + window) for deduplication.
 *
 * @example
 * ```ts
 * import { WorkerNotifier } from "@orbital-stellar/worker-core";
 *
 * const notifier = new WorkerNotifier({
 *   webhook: {
 *     url: "https://api.example.com/webhooks/workers",
 *     secret: "my-webhook-secret",
 *   },
 * });
 *
 * // Notify when a worker fires
 * notifier.notifyFired({
 *   workerId: "price-feed-1",
 *   window: "2026-01-01T00:00:00Z/PT1H",
 *   txHash: "abc123...",
 *   ledger: 12345,
 * });
 *
 * // Notify when a worker misses (deduplicated per window)
 * notifier.notifyMissed({
 *   workerId: "price-feed-1",
 *   window: "2026-01-01T00:00:00Z/PT1H",
 *   failures: [{ error: "Timeout", timestamp: "...", attempt: 3 }],
 * });
 * ```
 */
export class WorkerNotifier {
  private watcher: Watcher;
  private delivery: WebhookDelivery;
  private missDedup: MissDedupStore;

  constructor(config: WorkerNotifyConfig) {
    this.watcher = new WorkerWatcher();
    this.missDedup = new MissDedupStore();
    this.delivery = new WebhookDelivery(this.watcher, config.webhook, config.deadLetterStore);
  }

  /**
   * Delivers a worker.fired event through the webhook signing and retry path.
   *
   * @param event - The worker-fired event data (without type field, which is set automatically).
   */
  notifyFired(
    event: Omit<WorkerFiredEvent, "type" | "timestamp" | "timestampDate"> & {
      timestamp?: string;
    },
  ): void {
    const firedEvent: WorkerFiredEvent = {
      type: "worker.fired",
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
      get timestampDate() {
        return new Date(firedEvent.timestamp);
      },
    };
    const normalized = workerEventToNormalized(firedEvent);
    this.watcher.emit("*", normalized);
  }

  /**
   * Delivers a worker.missed event through the webhook signing and retry path.
   * Miss notifications are deduplicated per (workerId, window) pair - only the
   * first miss for a given window triggers a webhook delivery.
   *
   * @param event - The worker-missed event data (without type field, which is set automatically).
   * @returns true if the notification was sent, false if it was deduplicated.
   */
  notifyMissed(
    event: Omit<WorkerMissedEvent, "type" | "timestamp" | "timestampDate"> & {
      timestamp?: string;
    },
  ): boolean {
    if (this.missDedup.has(event.workerId, event.window)) {
      return false;
    }

    const missedEvent: WorkerMissedEvent = {
      type: "worker.missed",
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
      get timestampDate() {
        return new Date(missedEvent.timestamp);
      },
    };
    this.missDedup.add(event.workerId, event.window);
    const normalized = workerEventToNormalized(missedEvent);
    this.watcher.emit("*", normalized);
    return true;
  }

  /**
   * Checks if a miss notification has already been sent for the given worker and window.
   */
  hasMissBeenNotified(workerId: string, window: string): boolean {
    return this.missDedup.has(workerId, window);
  }

  /**
   * Stops the webhook delivery and clears pending retries.
   */
  stop(): void {
    this.delivery.stop();
  }

  /**
   * Reports whether this notifier and its underlying webhook delivery are healthy.
   */
  async healthCheck(): Promise<{ ok: boolean; reasons: string[] }> {
    return this.delivery.healthCheck();
  }

  /**
   * Clears the miss deduplication store. Call when windows are known to be
   * fully processed to prevent unbounded memory growth.
   */
  clearMissDedup(): void {
    this.missDedup.clear();
  }
}

/**
 * Internal Watcher subclass used to bridge WorkerNotifier to WebhookDelivery.
 * Only emits events; does not connect to any network source.
 */
class WorkerWatcher extends Watcher {
  constructor() {
    super("worker-notifier", { strictStoppedListeners: false });
  }
}
