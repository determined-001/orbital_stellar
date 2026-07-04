import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStellarEvent } from "../src/index.ts";
import { __resetConnectionPoolForTests } from "../src/connectionPool.ts";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

// ---------------------------------------------------------------------------
// Minimal EventSource stub
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {}

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

function makeEvent(type: string, extra?: Record<string, unknown>): NormalizedEvent {
  return { type, timestamp: new Date().toISOString(), ...extra } as unknown as NormalizedEvent;
}

function getSource(): MockEventSource {
  const src = MockEventSource.instances[0];
  if (!src) throw new Error("No MockEventSource instance created");
  return src;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useStellarEvent — filter predicate", () => {
  it("updates state when filter returns true", () => {
    const filter = vi.fn(() => true);
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS, { filter }));

    act(() => getSource().onopen?.());
    act(() => getSource().emit(makeEvent("payment.received")));

    expect(filter).toHaveBeenCalledOnce();
    expect(result.current.event?.type).toBe("payment.received");
  });

  it("suppresses state update when filter returns false", () => {
    const filter = vi.fn(() => false);
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS, { filter }));

    act(() => getSource().onopen?.());
    act(() => getSource().emit(makeEvent("payment.received")));

    expect(filter).toHaveBeenCalledOnce();
    expect(result.current.event).toBeNull();
  });

  it("receives the incoming event as the filter argument", () => {
    const filter = vi.fn(() => true);
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS, { filter }));

    const ev = makeEvent("payment.received");
    act(() => getSource().onopen?.());
    act(() => getSource().emit(ev));

    expect(filter).toHaveBeenCalledWith(expect.objectContaining({ type: "payment.received" }));
    expect(result.current.event).not.toBeNull();
  });

  it("allows some events through and blocks others based on predicate", () => {
    let allow = true;
    const filter = vi.fn(() => allow);
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS, { filter }));

    act(() => getSource().onopen?.());

    // First event — allowed
    act(() => getSource().emit(makeEvent("payment.received")));
    expect(result.current.event?.type).toBe("payment.received");

    // Second event — blocked
    allow = false;
    act(() => getSource().emit(makeEvent("account.created")));
    expect(result.current.event?.type).toBe("payment.received");
  });
});

describe("useStellarEvent — onEvent callback", () => {
  it("fires onEvent for every incoming event", () => {
    const onEvent = vi.fn();
    renderHook(() => useStellarEvent(SERVER, ADDRESS, { onEvent }));

    act(() => getSource().onopen?.());
    act(() => getSource().emit(makeEvent("payment.received")));
    act(() => getSource().emit(makeEvent("account.created")));

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("fires onEvent even when filter suppresses state update", () => {
    const filter = vi.fn(() => false);
    const onEvent = vi.fn();
    const { result } = renderHook(() => useStellarEvent(SERVER, ADDRESS, { filter, onEvent }));

    act(() => getSource().onopen?.());
    act(() => getSource().emit(makeEvent("payment.received")));

    // onEvent fired, state not updated
    expect(onEvent).toHaveBeenCalledOnce();
    expect(result.current.event).toBeNull();
  });

  it("receives the incoming event as the onEvent argument", () => {
    const onEvent = vi.fn();
    renderHook(() => useStellarEvent(SERVER, ADDRESS, { onEvent }));

    const ev = makeEvent("payment.received");
    act(() => getSource().onopen?.());
    act(() => getSource().emit(ev));

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "payment.received" }));
  });

  it("does not cause a re-render by itself when state is unchanged", () => {
    let renderCount = 0;
    const onEvent = vi.fn();
    const filter = vi.fn(() => false);

    renderHook(() => {
      renderCount++;
      return useStellarEvent(SERVER, ADDRESS, { filter, onEvent });
    });

    const renderCountAfterMount = renderCount;

    act(() => getSource().onopen?.());
    // onopen triggers a connected state change — renderCount may increase here
    const renderCountAfterOpen = renderCount;

    act(() => getSource().emit(makeEvent("payment.received")));

    // onEvent fired, filter blocked state update — no extra re-render beyond open
    expect(onEvent).toHaveBeenCalledOnce();
    expect(renderCount).toBe(renderCountAfterOpen);
  });
});
