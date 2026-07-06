import type { NormalizedEvent, Watcher, WatcherNotification } from "@orbital-stellar/pulse-core";

/** Terminal failure payload recorded by a dead-letter store. */
export type DeadLetterFailure = {
  url: string;
  event: NormalizedEvent;
  error: string;
  attempts: number;
  failedAt?: number;
};

/** Stored dead-letter entry returned from {@link DeadLetterStore.list}. */
export type DeadLetterEntry = {
  id: string;
  url: string;
  event: NormalizedEvent;
  error: string;
  attempts: number;
  timestamp: number;
  replayedAt?: number | null;
};

export type DeadLetterFilter = {
  url?: string;
  since?: number;
  until?: number;
  limit?: number;
};

/** Called by {@link DeadLetterStore.replay} to re-enqueue a stored failure. */
export type ReplayHandler = (entry: DeadLetterEntry) => Promise<void>;

/**
 * Store for terminal webhook failures (`webhook.failed`, `webhook.dropped`).
 *
 * Implementations must support querying by URL and time window, replaying stored
 * events, and computing per-URL failure rates over a sliding window.
 */
export interface DeadLetterStore {
  record(failure: DeadLetterFailure): Promise<string>;
  list(filter?: DeadLetterFilter): Promise<DeadLetterEntry[]>;
  replay(failureId: string): Promise<void>;
  failureRate(url: string, windowMs: number): Promise<number>;
}

/**
 * Subscribes a dead-letter store to terminal webhook watcher events.
 *
 * When {@link WebhookDelivery} is constructed with a store, it records failures
 * directly before emitting `webhook.failed` / `webhook.dropped` so consumers can
 * correlate via `dlqId`. Use this helper when terminal events originate elsewhere
 * and should still be persisted automatically.
 */
export function configureDeadLetterStore(watcher: Watcher, store: DeadLetterStore): () => void {
  const onFailed = (event: NormalizedEvent | WatcherNotification) => {
    if (!("raw" in event)) return;
    const raw = event.raw;
    if (!raw || typeof raw !== "object" || !("url" in raw)) return;
    if ("dlqId" in raw) return;

    const failure = raw as unknown as {
      url: string;
      error: string;
      attempts: number;
      originalEvent: NormalizedEvent;
    };

    void store.record({
      url: failure.url,
      event: failure.originalEvent,
      error: failure.error,
      attempts: failure.attempts,
    });
  };

  const onDropped = (event: NormalizedEvent | WatcherNotification) => {
    if (!("raw" in event)) return;
    const raw = event.raw;
    if (!raw || typeof raw !== "object" || !("url" in raw)) return;

    const dropped = raw as unknown as {
      reason: string;
      url: string;
      originalEvent: NormalizedEvent;
    };

    void store.record({
      url: dropped.url,
      event: dropped.originalEvent,
      error: dropped.reason,
      attempts: 0,
    });
  };

  watcher.on("webhook.failed", onFailed);
  watcher.on("webhook.dropped", onDropped);

  return () => {
    watcher.removeListener("webhook.failed", onFailed);
    watcher.removeListener("webhook.dropped", onDropped);
  };
}
