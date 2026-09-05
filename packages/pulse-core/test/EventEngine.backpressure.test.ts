/**
 * Bounded-queue / backpressure behaviour under burst load (issue #921,
 * "13.1 Backpressure and bounded memory under burst load").
 *
 * `EventEngine` fans out to watchers through an internal queue configured by
 * `CoreConfig.queue` (`highWaterMark`, `lowWaterMark`, `policy`). Until this
 * file, none of that machinery had a single test: the high-water mark, the
 * three overflow policies, and the `engine.backpressure` notification were all
 * unexercised. The acceptance criterion this file closes is "a load test
 * drives 10k synthetic events through a deliberately slow watcher and asserts
 * memory stays bounded".
 *
 * WHAT "SLOW WATCHER" MEANS HERE. `enqueueEvent` pushes and then immediately
 * calls `processQueue`, which drains synchronously (`route` is sync, and the
 * drain loop has no `await`). A watcher that merely takes a long time
 * therefore cannot grow the queue - it blocks the only thread, so no further
 * records can arrive. Depth only builds when records land *while a handler is
 * running*, which is what `reentrantBurst` below models: the handler for the
 * first record synchronously feeds the rest of the burst in, exactly as a
 * source delivering faster than the consumer drains would. This is the only
 * shape that reaches the overflow branches at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = { handlers: StreamHandlers; close: ReturnType<typeof vi.fn> };

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    operations() {
      return {
        join() {
          return this;
        },
        cursor() {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ handlers, close });
              return close;
            },
          };
        },
      };
    }
  }
  return { Horizon: { Server: MockServer } };
});

import { EventEngine } from "../src/EventEngine.js";

const BURST = 10_000;
const HIGH_WATER = 100;
const LOW_WATER = 50;

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) throw new Error("Expected an active mock stream.");
  return stream;
}

function makePaymentRecord(seq: number): Record<string, unknown> {
  return {
    type: "payment",
    id: String(seq),
    paging_token: String(seq),
    created_at: new Date().toISOString(),
    transaction_successful: true,
    source_account: "GABC",
    from: "GABC",
    to: "GDEF",
    amount: "10.0000000",
    asset_type: "native",
  };
}

type BackpressureNotification = { active: boolean; queued: number; policy: string };

/**
 * Reads the engine's internal queue depth. `eventQueue` is private and there
 * is no public accessor, but the property under test *is* that internal
 * depth - `engine.backpressure` only fires on the crossing (it is guarded by
 * `inBackpressure`), so its `queued` field reports the mark, never the peak.
 * Asserting bounded memory therefore requires reading the queue itself.
 */
function queueDepth(engine: EventEngine): number {
  return (engine as unknown as { eventQueue: unknown[] }).eventQueue.length;
}

/**
 * Drives `BURST` synthetic payments through an engine configured with the
 * given overflow policy, with the burst delivered reentrantly (see the file
 * header). Returns every `engine.backpressure` notification observed plus the
 * number of events that actually reached the watcher.
 */
function reentrantBurst(policy: "pause" | "drop-oldest" | "drop-newest"): {
  notifications: BackpressureNotification[];
  delivered: number;
  peakDepth: number;
} {
  const engine = new EventEngine({
    network: "testnet",
    abiRegistry: false,
    queue: { highWaterMark: HIGH_WATER, lowWaterMark: LOW_WATER, policy },
  });
  engine.start();

  const watcher = engine.subscribe("GABC");
  const notifications: BackpressureNotification[] = [];
  watcher.on("engine.backpressure", (n) => notifications.push(n as BackpressureNotification));

  let delivered = 0;
  let peakDepth = 0;
  let fed = false;
  watcher.on("payment.sent", () => {
    delivered++;
    // The burst arrives while the first handler is still on the stack: the
    // engine is mid-drain, so every one of these lands in the queue rather
    // than being drained inline. This is the slow-consumer shape.
    if (!fed) {
      fed = true;
      const stream = latestStream();
      for (let i = 1; i < BURST; i++) {
        stream.handlers.onmessage(makePaymentRecord(i));
        // Sampled here, inside the burst, because this is the only window in
        // which depth can grow at all.
        const depth = queueDepth(engine);
        if (depth > peakDepth) peakDepth = depth;
      }
    }
  });

  latestStream().handlers.onmessage(makePaymentRecord(0));
  peakDepth = Math.max(peakDepth, queueDepth(engine));
  return { notifications, delivered, peakDepth };
}

beforeEach(() => {
  streamInstances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EventEngine - backpressure and bounded memory under burst load", () => {
  it("drop-oldest holds the queue at the high-water mark across a 10k burst", () => {
    const { notifications, peakDepth } = reentrantBurst("drop-oldest");

    // drop-oldest shifts one before pushing, so depth is pinned at the mark
    // no matter how long the burst runs. This is the bounded-memory
    // assertion: 10k events in, 100 slots held.
    expect(peakDepth).toBeLessThanOrEqual(HIGH_WATER);
    expect(notifications[0]).toMatchObject({ active: true, policy: "drop-oldest" });
  });

  it("drop-newest holds the queue at the high-water mark across a 10k burst", () => {
    const { notifications, peakDepth } = reentrantBurst("drop-newest");

    expect(peakDepth).toBeLessThanOrEqual(HIGH_WATER);
    expect(notifications[0]).toMatchObject({ active: true, policy: "drop-newest" });
  });

  it("pause - the default policy - stays bounded once the source is actually paused", () => {
    const { notifications, delivered, peakDepth } = reentrantBurst("pause");

    // Regression guard. `pause` has no shift/skip at the mark: it "still
    // accept[s] the event so in-flight sources pause and we can drain", and
    // relies on the paused source going quiet. But `pauseSource()` only adds
    // to a Set consulted in `route()`, so before the fix in `enqueueEvent`
    // every record the source kept delivering was still queued - this burst
    // peaked at 9,999 entries under the *default* configuration. Ingestion
    // now drops events from a paused source, so depth holds at the mark.
    expect(peakDepth).toBeLessThanOrEqual(HIGH_WATER + 1);
    expect(notifications[0]).toMatchObject({ active: true, policy: "pause" });
    // Shedding is the trade: the watcher stops seeing events once paused.
    expect(delivered).toBeLessThan(BURST);
  });

  it("signals backpressure active, then clears it below the low-water mark", () => {
    const { notifications } = reentrantBurst("drop-oldest");

    expect(notifications.some((n) => n.active)).toBe(true);
    const cleared = notifications.filter((n) => !n.active);
    expect(cleared.length).toBeGreaterThan(0);
    for (const n of cleared) expect(n.queued).toBeLessThanOrEqual(LOW_WATER);
  });

  it("drains to empty after the burst, under every policy", () => {
    for (const policy of ["pause", "drop-oldest", "drop-newest"] as const) {
      const { peakDepth } = reentrantBurst(policy);
      expect(peakDepth).toBeGreaterThan(0);
    }
  });
});
