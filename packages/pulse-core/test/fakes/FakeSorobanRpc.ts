// packages/pulse-core/test/fakes/FakeSorobanRpc.ts

export interface FakeSorobanEvent {
  id: string;
  pagingToken: string;
  topic: string[];
  value: string;
}

export class FakeSorobanRpc {
  private events: FakeSorobanEvent[] = [];
  public callCount = 0;

  /**
   * When set, `getEvents` will block until this Promise resolves before
   * returning results.  Tests can use this to simulate a slow in-flight RPC
   * call and verify that `stop()` aborts it cleanly.
   */
  public stallUntil: Promise<void> | null = null;

  constructor() {
    // Generate 200 deterministic mock events with sequential string tokens
    for (let i = 1; i <= 200; i++) {
      const token = i.toString().padStart(6, "0"); // "000001", "000002", etc.
      this.events.push({
        id: `evt-${token}`,
        pagingToken: token,
        topic: ["transfer"],
        value: `value-${i}`,
      });
    }
  }

  /**
   * Simulates fetching events from Soroban RPC with limit-based pagination.
   *
   * Accepts an optional `AbortSignal`; if the signal fires while the call is
   * stalled the method rejects with an `AbortError` — matching the behaviour
   * of the real Fetch API / undici.
   */
  async getEvents(
    startCursor: string | undefined,
    limit = 100,
    signal?: AbortSignal,
  ): Promise<{ events: FakeSorobanEvent[] }> {
    this.callCount++;

    // If a stall is configured, wait for it (or for an abort).
    if (this.stallUntil) {
      await Promise.race([
        this.stallUntil,
        new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          signal?.addEventListener("abort", () => reject(abortError()), {
            once: true,
          });
        }),
      ]);
    }

    // Check abort after any async gap.
    if (signal?.aborted) {
      throw abortError();
    }

    // Find where to resume slicing based on the provided cursor token
    const startIndex = startCursor
      ? this.events.findIndex((e) => e.pagingToken === startCursor) + 1
      : 0;

    if (startIndex < 0 || startIndex >= this.events.length) {
      return { events: [] };
    }

    // Return the specific page requested by the subscriber
    const page = this.events.slice(startIndex, startIndex + limit);
    return { events: page };
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
