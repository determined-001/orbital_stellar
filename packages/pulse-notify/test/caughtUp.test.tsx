/**
 * Tests for the caughtUp flag in EventState.
 *
 * caughtUp is true on a fresh connection (nothing to replay) and transitions
 * false → true when the EventSource auto-reconnects after a network drop and
 * the server replays events via Last-Event-ID.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStellarEvent } from "../src/index.ts";
import { __resetConnectionPoolForTests } from "../src/connectionPool.ts";

// ---------------------------------------------------------------------------
// MockEventSource that supports lastEventId on emitted messages
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closeCount += 1;
  }

  /** Fire onmessage with an optional SSE id field. */
  emit(event: unknown, lastEventId = "") {
    this.onmessage?.({ data: JSON.stringify(event), lastEventId });
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

function getSource(): MockEventSource {
  const src = MockEventSource.instances[0];
  if (!src) throw new Error("No MockEventSource instance created");
  return src;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("caughtUp flag", () => {
  it("is true before any connection opens (initial state)", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    expect(result.current.caughtUp).toBe(true);
  });

  it("remains true on fresh open when no prior event ID was recorded", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    act(() => {
      src.onopen?.();
    });

    expect(result.current.caughtUp).toBe(true);
  });

  it("remains true when events arrive without an SSE id field", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    act(() => {
      src.onopen?.();
    });
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" });
    });

    expect(result.current.caughtUp).toBe(true);
  });

  it("is true while receiving events with an SSE id field (live stream)", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    act(() => {
      src.onopen?.();
    });
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" }, "cursor-1");
    });

    expect(result.current.caughtUp).toBe(true);
  });

  it("flips to false on reconnect open when a prior event ID was recorded", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    // Initial connection — receive an event with an SSE id
    act(() => {
      src.onopen?.();
    });
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" }, "cursor-1");
    });
    expect(result.current.caughtUp).toBe(true);

    // Network drop — EventSource fires onerror, then auto-reconnects (onopen again)
    act(() => {
      src.onerror?.();
    });
    act(() => {
      src.onopen?.();
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.caughtUp).toBe(false);
  });

  it("returns to true when the first replay event arrives after reconnect", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    // Establish, receive event with id, drop, reconnect
    act(() => {
      src.onopen?.();
    });
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" }, "cursor-1");
    });
    act(() => {
      src.onerror?.();
    });
    act(() => {
      src.onopen?.();
    });

    expect(result.current.caughtUp).toBe(false);

    // Replay event arrives
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:01Z" }, "cursor-2");
    });

    expect(result.current.caughtUp).toBe(true);
  });

  it("does not flip to false on reconnect when no event id was ever received", () => {
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS));
    const src = getSource();

    // Connect, receive events without id, drop, reconnect
    act(() => {
      src.onopen?.();
    });
    act(() => {
      src.emit({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" });
    });
    act(() => {
      src.onerror?.();
    });
    act(() => {
      src.onopen?.();
    });

    // No prior id — server wasn't sending id fields, so no replay expected
    expect(result.current.caughtUp).toBe(true);
  });
});
