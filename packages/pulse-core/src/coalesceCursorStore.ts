import { CursorStore } from "./CursorStore.js";

/**
 * Options for {@link coalesceCursorStore}.
 */
export interface CoalescingStoreOptions {
  /**
   * Maximum milliseconds between automatic flush cycles.
   * Must be a positive finite integer.
   */
  intervalMs: number;
}

/**
 * A write-coalescing decorator for any {@link CursorStore}.
 *
 * All writes are buffered in memory and flushed to the inner store on a
 * configurable interval. Only the most-recent cursor per stream key is
 * written during each flush cycle (last-write-wins).
 *
 * Use {@link flush} before process exit to drain pending writes.
 * Use {@link dispose} to cancel the background timer.
 */
export class CoalescingStore extends CursorStore {
  readonly #inner: CursorStore;
  readonly #buffer: Map<string, string> = new Map();
  #timer: ReturnType<typeof setInterval>;
  #flushInProgress: Promise<void> = Promise.resolve();

  constructor(inner: CursorStore, intervalMs: number) {
    super();
    this.#inner = inner;
    this.#timer = setInterval(() => {
      this.#flushInProgress = this.#flushInProgress.then(() => this.#doFlush());
    }, intervalMs);
    // Allow the Node.js process to exit even if the timer is still active
    if (typeof this.#timer === "object" && this.#timer !== null && "unref" in this.#timer) {
      (this.#timer as { unref(): void }).unref();
    }
  }

  // ---------------------------------------------------------------------------
  // CursorStore interface
  // ---------------------------------------------------------------------------

  async get(streamKey: string): Promise<string | null> {
    if (this.#buffer.has(streamKey)) {
      return this.#buffer.get(streamKey)!;
    }
    return this.#inner.get(streamKey);
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.#buffer.set(streamKey, cursor);
  }

  override async getMany(keys: string[]): Promise<Record<string, string | null>> {
    if (keys.length === 0) return {};

    const result: Record<string, string | null> = {};
    const missedKeys: string[] = [];

    for (const key of keys) {
      if (this.#buffer.has(key)) {
        result[key] = this.#buffer.get(key)!;
      } else {
        missedKeys.push(key);
      }
    }

    if (missedKeys.length > 0) {
      const innerResult = await this.#inner.getMany(missedKeys);
      for (const key of missedKeys) {
        result[key] = innerResult[key] ?? null;
      }
    }

    return result;
  }

  override async setMany(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.#buffer.set(key, value);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle methods
  // ---------------------------------------------------------------------------

  /**
   * Immediately flushes all pending writes to the inner store.
   *
   * Serializes with any in-progress scheduled flush — waits for it to
   * complete before draining the buffer, ensuring each entry is written
   * exactly once.
   *
   * Call this before process exit to reduce the loss window to zero.
   */
  flush(): Promise<void> {
    this.#flushInProgress = this.#flushInProgress.then(() => this.#doFlush());
    return this.#flushInProgress;
  }

  /**
   * Cancels the recurring flush timer.
   *
   * Does NOT flush pending writes — call {@link flush} first if you need
   * a clean shutdown. Any buffered values remaining after `dispose()` are
   * discarded.
   */
  dispose(): void {
    clearInterval(this.#timer);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async #doFlush(): Promise<void> {
    if (this.#buffer.size === 0) return;
    // Snapshot-then-clear: clear the buffer BEFORE the async setMany call so
    // that writes arriving during I/O accumulate in the now-empty buffer and
    // are picked up by the next flush cycle.
    const snapshot = Object.fromEntries(this.#buffer);
    this.#buffer.clear();
    await this.#inner.setMany(snapshot);
  }
}

/**
 * Wraps any {@link CursorStore} with write-coalescing behaviour.
 *
 * High-throughput engines call `set` after every processed event. Stores
 * such as Postgres and S3 charge per write, making per-event persistence
 * expensive at scale. This wrapper buffers all writes in memory and flushes
 * them to the inner store every `intervalMs` milliseconds, reducing N writes
 * per interval to at most one `setMany` call per stream key.
 *
 * **Loss window**: On an unclean process exit, up to `intervalMs` milliseconds
 * of cursor progress may be lost. The engine will replay events from the last
 * durably persisted cursor on restart.
 *
 * **Graceful shutdown**: Call `flush()` before process exit to drain all
 * pending writes. This reduces the loss window to zero for all events
 * processed before `flush()` was called.
 *
 * **Timer cleanup**: Call `dispose()` to cancel the background flush timer.
 * `dispose()` does NOT flush pending writes — call `flush()` first if needed.
 *
 * @param inner - The underlying CursorStore that performs durable writes.
 * @param options - Configuration options.
 * @param options.intervalMs - Maximum milliseconds between flush cycles.
 *   Must be a positive finite number.
 * @throws {RangeError} If `intervalMs` is not a positive finite number.
 *
 * @example
 * const store = coalesceCursorStore(new PostgresCursorStore(pool), { intervalMs: 5000 });
 * // On graceful shutdown:
 * await store.flush();
 * store.dispose();
 */
export function coalesceCursorStore(
  inner: CursorStore,
  options: CoalescingStoreOptions,
): CoalescingStore {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new RangeError(
      `coalesceCursorStore: intervalMs must be a positive finite number, got ${options.intervalMs}`,
    );
  }
  return new CoalescingStore(inner, options.intervalMs);
}
