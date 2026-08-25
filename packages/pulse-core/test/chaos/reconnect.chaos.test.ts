import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FaultyHorizonServer,
  latestStream,
  malformedRecord,
  paymentRecord,
  rateLimitError,
  resetStreams,
  resolveSeed,
  seededRandom,
  streams,
  SUBSCRIBER,
  transportError,
} from "./harness.js";

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@stellar/stellar-sdk");
  return { ...actual, Horizon: { Server: FaultyHorizonServer } };
});

const { EventEngine } = await import("../../src/EventEngine.js");
const { MemoryCursorStore } = await import("../../src/MemoryCursorStore.js");
const { fullJitterBackoffMs } = await import("../../src/backoff.js");

const ADDRESS = SUBSCRIBER;
const SEED = resolveSeed();

/** Drives the pending reconnect timer and lets the engine reopen its stream. */
async function advanceReconnect(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  await vi.runOnlyPendingTimersAsync();
}

describe(`reconnection chaos (#922, seed ${SEED})`, () => {
  let random: () => number;

  beforeEach(() => {
    resetStreams();
    vi.useFakeTimers();
    random = seededRandom(SEED);
    vi.spyOn(Math, "random").mockImplementation(() => random());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loses no events and delivers no duplicates across injected faults", async () => {
    const cursorStore = new MemoryCursorStore();
    const engine = new EventEngine({
      network: "testnet",
      cursorStore,
      reconnect: { initialDelayMs: 10, maxDelayMs: 100 },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();

    const received: string[] = [];
    engine.subscribe(ADDRESS).on("payment.received", (event) => {
      received.push(String(event.raw?.paging_token ?? ""));
    });

    // A payment arrives, then the transport drops mid-stream. Repeat with a
    // different fault each round; the ledger keeps producing regardless.
    const faults = [
      () => latestStream().handlers.onerror(transportError("socket hang up")),
      () => latestStream().handlers.onerror(transportError("ECONNRESET")),
      () => latestStream().handlers.onerror(rateLimitError(1)),
      () => latestStream().handlers.onmessage(malformedRecord()),
      () => latestStream().handlers.onerror(transportError("EAI_AGAIN horizon-testnet")),
    ];

    let sequence = 0;
    for (const injectFault of faults) {
      latestStream().handlers.onmessage(paymentRecord(++sequence));
      await vi.advanceTimersByTimeAsync(0);
      injectFault();
      await advanceReconnect();
    }
    latestStream().handlers.onmessage(paymentRecord(++sequence));
    await vi.advanceTimersByTimeAsync(0);

    const expected = Array.from({ length: sequence }, (_, index) => String(index + 1));
    expect(received).toEqual(expected);
    expect(new Set(received).size).toBe(received.length);

    // The cursor is the proof a consumer would use after a crash: it must have
    // advanced to the last delivered event, not to a gap or a replayed one.
    expect(await cursorStore.get(`horizon:testnet`)).toBe(String(sequence));

    engine.stop();
  });

  it("resumes each reconnect from the persisted cursor, never from 'now'", async () => {
    const cursorStore = new MemoryCursorStore();
    const engine = new EventEngine({
      network: "testnet",
      cursorStore,
      reconnect: { initialDelayMs: 10, maxDelayMs: 100 },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();
    engine.subscribe(ADDRESS);

    latestStream().handlers.onmessage(paymentRecord(41));
    await vi.advanceTimersByTimeAsync(0);
    latestStream().handlers.onerror(transportError("stream aborted mid-frame"));
    await advanceReconnect();

    expect(latestStream().cursor).toBe("41");
    expect(streams.at(-2)?.closed).toBe(true);

    engine.stop();
  });

  it("honours Retry-After on 429 and falls back to a fixed delay without it", async () => {
    const notifications: { type: string; delayMs?: number }[] = [];
    const engine = new EventEngine({
      network: "testnet",
      reconnect: { initialDelayMs: 10, maxDelayMs: 100 },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();
    engine
      .subscribe(ADDRESS)
      .on("engine.rate_limited", (n) => notifications.push({ type: n.type, delayMs: n.delayMs }));

    latestStream().handlers.onerror(rateLimitError(7));
    await vi.advanceTimersByTimeAsync(0);
    expect(notifications.at(-1)).toEqual({ type: "engine.rate_limited", delayMs: 7000 });

    await advanceReconnect();
    latestStream().handlers.onerror(rateLimitError());
    await vi.advanceTimersByTimeAsync(0);
    expect(notifications.at(-1)).toEqual({ type: "engine.rate_limited", delayMs: 60000 });

    engine.stop();
  });

  it("keeps every backoff delay inside the documented full-jitter envelope", async () => {
    const delays: number[] = [];
    const initialDelayMs = 10;
    const maxDelayMs = 100;
    const engine = new EventEngine({
      network: "testnet",
      reconnect: { initialDelayMs, maxDelayMs },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();
    engine.subscribe(ADDRESS).on("engine.reconnecting", (n) => delays.push(n.delayMs ?? -1));

    for (let attempt = 0; attempt < 8; attempt++) {
      latestStream().handlers.onerror(transportError("connection reset"));
      await advanceReconnect();
    }

    expect(delays).toHaveLength(8);
    delays.forEach((delay, index) => {
      const ceiling = Math.min(initialDelayMs * 2 ** index, maxDelayMs);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(ceiling === 0 ? 1 : ceiling);
    });

    // Full jitter can legitimately return 0 once, but a transport that is down
    // must not produce an unbroken run of zero-delay retries - that is a busy
    // loop, and it is the failure mode this envelope exists to prevent.
    const longestZeroRun = delays.reduce(
      (acc, delay) =>
        delay === 0
          ? { run: acc.run + 1, max: Math.max(acc.max, acc.run + 1) }
          : { run: 0, max: acc.max },
      { run: 0, max: 0 },
    ).max;
    expect(longestZeroRun).toBeLessThan(delays.length);

    engine.stop();
  });

  it("stops retrying at maxRetries instead of looping forever", async () => {
    const engine = new EventEngine({
      network: "testnet",
      reconnect: { initialDelayMs: 10, maxDelayMs: 100, maxRetries: 3 },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();
    engine.subscribe(ADDRESS);

    for (let attempt = 0; attempt < 6; attempt++) {
      latestStream().handlers.onerror(transportError("connection reset"));
      await advanceReconnect();
    }

    // 1 initial stream + 3 permitted reconnects.
    expect(streams).toHaveLength(4);

    engine.stop();
  });

  it("survives malformed records without emitting or dropping the stream", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    await vi.runOnlyPendingTimersAsync();

    const received: unknown[] = [];
    engine.subscribe(ADDRESS).on("*", (event) => received.push(event));

    const streamCountBefore = streams.length;
    latestStream().handlers.onmessage(malformedRecord());
    latestStream().handlers.onmessage({ type: "totally-unknown-operation", id: "9" });
    await vi.advanceTimersByTimeAsync(0);

    expect(received).toHaveLength(0);
    expect(streams).toHaveLength(streamCountBefore);
    expect(latestStream().closed).toBe(false);

    engine.stop();
  });

  it("a stalled stream is left open - the engine does not spin on silence", async () => {
    const engine = new EventEngine({
      network: "testnet",
      reconnect: { initialDelayMs: 10, maxDelayMs: 100 },
    });
    engine.start();
    await vi.runOnlyPendingTimersAsync();
    engine.subscribe(ADDRESS);

    const streamCountBefore = streams.length;
    // Half-open socket: no frames, no error, no close for a long while.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(streams).toHaveLength(streamCountBefore);
    expect(latestStream().closed).toBe(false);

    engine.stop();
  });
});

describe("full-jitter backoff envelope (#922)", () => {
  it("never exceeds the exponential ceiling for any attempt or seed", () => {
    const random = seededRandom(SEED);
    const spy = vi.spyOn(Math, "random").mockImplementation(() => random());

    for (let attempt = 1; attempt <= 12; attempt++) {
      for (let sample = 0; sample < 50; sample++) {
        const delay = fullJitterBackoffMs(attempt, 1000, 30000);
        const ceiling = Math.min(1000 * 2 ** (attempt - 1), 30000);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(ceiling);
      }
    }

    spy.mockRestore();
  });
});
