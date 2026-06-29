import type { RetryQueue, RetryRecord } from "./RetryQueue.js";

export type MemoryRetryQueueOptions = {
  /** Clock source, injectable for testing. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * How long a dequeued record stays "in-flight" before it is automatically
   * reclaimed (re-queued) on the next dequeue. Mirrors the Redis queue so a
   * consumer crash between dequeue and ack does not lose the retry. Defaults to
   * 30,000ms.
   */
  visibilityTimeoutMs?: number;
};

const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

type Entry = { record: RetryRecord; seq: number };

/**
 * In-memory reference implementation of {@link RetryQueue}.
 *
 * It is a drop-in, dependency-free queue with the same observable semantics as
 * {@link RedisRetryQueue}: records are ordered by `nextRetryAt`, `dequeue` only
 * returns due records (moving them to an in-flight set guarded by a visibility
 * timeout), `evictNewest` sheds the furthest-future record under backpressure,
 * and `size` counts only queued (not in-flight) records.
 *
 * Being in-memory it is **not durable** across process restarts — it exists as
 * the canonical contract reference and for tests; use {@link RedisRetryQueue}
 * (or another backing store) for real durability.
 */
export class MemoryRetryQueue implements RetryQueue {
  private readonly queued = new Map<string, Entry>();
  private readonly inFlight = new Map<string, { record: RetryRecord; expiresAt: number }>();
  private readonly now: () => number;
  private readonly visibilityTimeoutMs: number;
  private seq = 0;

  constructor(options: MemoryRetryQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.visibilityTimeoutMs = Math.max(
      1,
      Math.floor(options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS),
    );
  }

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);
    // Store a copy so later external mutation can't corrupt queue state (this
    // mirrors the JSON round-trip the Redis queue performs).
    this.queued.set(record.id, { record: { ...record }, seq: this.seq++ });
  }

  async dequeue(nowMs: number = this.now()): Promise<RetryRecord | null> {
    this.reclaimExpiredInFlight(nowMs);

    // Earliest-due record; ties broken by insertion order (FIFO).
    let best: Entry | undefined;
    for (const entry of this.queued.values()) {
      if (entry.record.nextRetryAt > nowMs) continue;
      if (
        best === undefined ||
        entry.record.nextRetryAt < best.record.nextRetryAt ||
        (entry.record.nextRetryAt === best.record.nextRetryAt && entry.seq < best.seq)
      ) {
        best = entry;
      }
    }
    if (best === undefined) return null;

    this.queued.delete(best.record.id);
    this.inFlight.set(best.record.id, {
      record: best.record,
      expiresAt: nowMs + this.visibilityTimeoutMs,
    });
    return { ...best.record };
  }

  async ack(recordId: string): Promise<void> {
    this.inFlight.delete(recordId);
  }

  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const inFlight = this.inFlight.get(recordId);
    if (inFlight === undefined) return;

    this.inFlight.delete(recordId);
    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    await this.enqueue({ ...inFlight.record, nextRetryAt: this.now() + delayMs });
  }

  async evictNewest(): Promise<RetryRecord | null> {
    // Newest = furthest-future schedule; ties broken by most-recent insertion.
    let newest: Entry | undefined;
    for (const entry of this.queued.values()) {
      if (
        newest === undefined ||
        entry.record.nextRetryAt > newest.record.nextRetryAt ||
        (entry.record.nextRetryAt === newest.record.nextRetryAt && entry.seq > newest.seq)
      ) {
        newest = entry;
      }
    }
    if (newest === undefined) return null;

    this.queued.delete(newest.record.id);
    return { ...newest.record };
  }

  async size(): Promise<number> {
    return this.queued.size;
  }

  private reclaimExpiredInFlight(nowMs: number): void {
    for (const [id, entry] of this.inFlight) {
      if (entry.expiresAt <= nowMs) {
        this.inFlight.delete(id);
        this.queued.set(id, { record: { ...entry.record, nextRetryAt: nowMs }, seq: this.seq++ });
      }
    }
  }

  private assertRecord(record: RetryRecord): void {
    if (!record.id) {
      throw new Error("RetryRecord.id is required");
    }
    if (!Number.isFinite(record.nextRetryAt)) {
      throw new Error("RetryRecord.nextRetryAt must be a finite timestamp");
    }
  }
}
