import type { NormalizedEvent } from "@orbital/pulse-core";

/**
 * A pluggable backing store for pending webhook retries.
 *
 * `WebhookDelivery` ships with in-process timer-based retries by default
 * (no queue required). Supplying a `RetryQueue` lets retries be backed by a
 * durable store (Redis, Postgres, SQS, …) so pending deliveries survive a
 * process restart. See the Wave 1.3 replay-primitives roadmap.
 *
 * The contract here is intentionally minimal — it is the surface
 * `WebhookDelivery` needs for health reporting. Enqueue/dequeue semantics
 * for full durable replay are layered on by concrete adapters.
 */
export interface RetryQueue {
  /**
   * Number of retries currently pending in the queue. May be async for
   * stores that require a round-trip to count.
   */
  size(): number | Promise<number>;

  /**
   * Optional liveness probe for the backing store.
   *
   * Implementations backed by a remote store should round-trip a cheap
   * command (e.g. Redis `PING`) and **reject** if the store is unreachable.
   * `WebhookDelivery.healthCheck()` treats a rejected ping as a degraded
   * backing store and flips delivery health to `unhealthy`.
   *
   * Omit this method entirely for purely in-process queues that cannot fail.
   */
  ping?(): Promise<void>;
}

/**
 * In-memory reference adapter for {@link RetryQueue}.
 *
 * Holds pending retries in a plain array. `ping()` always resolves — an
 * in-process queue has no remote dependency that can become unreachable.
 * Useful as a default, for tests, and as a template for durable adapters.
 */
export class InMemoryRetryQueue implements RetryQueue {
  private pending: NormalizedEvent[] = [];

  enqueue(event: NormalizedEvent): void {
    this.pending.push(event);
  }

  dequeue(): NormalizedEvent | undefined {
    return this.pending.shift();
  }

  size(): number {
    return this.pending.length;
  }

  async ping(): Promise<void> {
    // In-process: nothing to reach, always healthy.
  }
}
