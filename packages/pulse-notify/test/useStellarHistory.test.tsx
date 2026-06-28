import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStellarHistory } from "../src/index.ts";
import { __resetConnectionPoolForTests } from "../src/connectionPool.ts";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

// ---------------------------------------------------------------------------
// Minimal EventSource stub — mirrors the pattern used in other test files.
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closeCount += 1;
  }

  /** Helper: fire a raw onmessage event with the given payload. */
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

let originalEventSource: typeof globalThis.EventSource;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  MockEventSource.instances = [];
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  __resetConnectionPoolForTests();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER = "https://events.example.com";
const ADDRESS = "GABC123";

function makeEvent(type: string, i: number): NormalizedEvent {
  return {
    type,
    timestamp: new Date(i * 1000).toISOString(),
  } as unknown as NormalizedEvent;
}

function getSource(): MockEventSource {
  const src = MockEventSource.instances[0];
  if (!src) throw new Error("No MockEventSource instance created");
  return src;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useStellarHistory", () => {
  it("starts with an empty history array", () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    expect(result.current.history).toEqual([]);
    expect(result.current.event).toBeNull();
  });

  it("accumulates incoming events in the history array", async () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    const src = getSource();
    src.onopen?.();

    act(() => {
      src.emit(makeEvent("payment.received", 1));
    });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.type).toBe("payment.received");

    act(() => {
      src.emit(makeEvent("payment.sent", 2));
    });
    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[1]?.type).toBe("payment.sent");
  });

  it("keeps events in arrival order (oldest first)", async () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    const src = getSource();
    src.onopen?.();

    const types = ["payment.received", "account.created", "trustline.added"];

    // Each event must be in its own act() — useStellarActivity only keeps the
    // most recent event in state, so batching all emits in one act() would
    // only add the last one to the history.
    for (const [i, type] of types.entries()) {
      act(() => {
        src.emit(makeEvent(type, i));
      });
    }

    const historyTypes = result.current.history.map((e) => e.type);
    expect(historyTypes).toEqual(types);
  });

  it("applies FIFO eviction once capacity is reached", async () => {
    const capacity = 3;
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS, { capacity }));

    const src = getSource();
    src.onopen?.();

    // Emit capacity + 2 events, one per act() so each triggers a state update.
    for (let i = 0; i < capacity + 2; i++) {
      act(() => {
        src.emit(makeEvent("payment.received", i));
      });
    }

    // History must not exceed capacity.
    expect(result.current.history).toHaveLength(capacity);

    // The oldest events are evicted; only the most recent `capacity` remain.
    // Events are indexed 0..4 — after eviction we expect indices 2, 3, 4.
    const timestamps = result.current.history.map((e) => e.timestamp);
    expect(timestamps).toEqual([
      new Date(2 * 1000).toISOString(),
      new Date(3 * 1000).toISOString(),
      new Date(4 * 1000).toISOString(),
    ]);
  });

  it("defaults capacity to 100 when no options are supplied", async () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    const src = getSource();
    src.onopen?.();

    // Emit exactly 100 events, one per act() so each is captured individually.
    for (let i = 0; i < 100; i++) {
      act(() => {
        src.emit(makeEvent("payment.received", i));
      });
    }
    expect(result.current.history).toHaveLength(100);

    // The 101st event triggers eviction — oldest (index 0) is dropped.
    act(() => {
      src.emit(makeEvent("payment.received", 100));
    });
    expect(result.current.history).toHaveLength(100);
    expect(result.current.history[0]?.timestamp).toBe(new Date(1 * 1000).toISOString());
    expect(result.current.history[99]?.timestamp).toBe(new Date(100 * 1000).toISOString());
  });

  it("exposes the latest event alongside the history array", async () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    const src = getSource();
    src.onopen?.();

    act(() => {
      src.emit(makeEvent("payment.received", 1));
    });
    act(() => {
      src.emit(makeEvent("payment.sent", 2));
    });

    // `event` is the most recent arrival, `history` is the full log.
    expect(result.current.event?.type).toBe("payment.sent");
    expect(result.current.history).toHaveLength(2);
  });

  it("reflects connected state from the underlying activity hook", () => {
    const { result } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    expect(result.current.connected).toBe(false);

    act(() => {
      getSource().onopen?.();
    });

    expect(result.current.connected).toBe(true);
  });

  it("does not double-count an event that is re-rendered without changing", async () => {
    const { result, rerender } = renderHook(() => useStellarHistory(SERVER, ADDRESS));

    const src = getSource();
    src.onopen?.();

    act(() => {
      src.emit(makeEvent("payment.received", 1));
    });

    expect(result.current.history).toHaveLength(1);

    // Force a re-render without any new event.
    rerender();

    // History must still have exactly one entry — no double-count.
    expect(result.current.history).toHaveLength(1);
  });
});
