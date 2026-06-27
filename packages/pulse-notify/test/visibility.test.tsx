import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
} from "../src/connectionPool.ts";
import { useStellarEvent } from "../src/index.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  closeCount = 0;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  close() {
    this.closeCount++;
  }
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

describe("Visibility-API integration", () => {
  let originalVisibilityState: any;

  beforeEach(() => {
    vi.useFakeTimers();
    originalVisibilityState = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      value: originalVisibilityState,
      writable: true,
      configurable: true,
    });
    __resetConnectionPoolForTests();
    MockEventSource.instances = [];
    cleanup();
  });

  function TestComponent({ hideAfterMs }: { hideAfterMs?: number }) {
    const state = useStellarEvent("https://events.example.com", "GABC", {
      hideAfterMs,
    });
    return (
      <div>
        <div data-testid="connected">{state.connected ? "connected" : "disconnected"}</div>
      </div>
    );
  }

  test("pauses connection when tab is hidden after hideAfterMs and reconnects when visible", async () => {
    const { getByTestId } = render(<TestComponent hideAfterMs={5000} />);

    // Wait for connection to open
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(getByTestId("connected").textContent).toBe("connected");
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    // Hide the tab
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance time before hideAfterMs threshold — connection must still be open
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(getByTestId("connected").textContent).toBe("connected");
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    // Advance past hideAfterMs threshold — connection must close
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(getByTestId("connected").textContent).toBe("disconnected");
    expect(__getConnectionPoolSizeForTests()).toBe(0);
    expect(MockEventSource.instances[0]!.closeCount).toBe(1);

    // Show the tab again — connection must restore
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Wait for new connection to open
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(getByTestId("connected").textContent).toBe("connected");
    expect(__getConnectionPoolSizeForTests()).toBe(1);
    expect(MockEventSource.instances.length).toBe(2);
  });

  test("does not pause connection if tab becomes visible before hideAfterMs expires", async () => {
    const { getByTestId } = render(<TestComponent hideAfterMs={5000} />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(getByTestId("connected").textContent).toBe("connected");

    // Hide the tab
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance time partly
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Show the tab again before timeout expires
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance past original timeout threshold
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Connection must stay open and not close
    expect(getByTestId("connected").textContent).toBe("connected");
    expect(__getConnectionPoolSizeForTests()).toBe(1);
    expect(MockEventSource.instances[0]!.closeCount).toBe(0);
  });
});
