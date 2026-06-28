import { useState } from "react";
import { render, act } from "@testing-library/react";
import { afterEach, expect, test, describe } from "vitest";
import { useStellarPayment } from "../src/index.ts";
import { __resetConnectionPoolForTests } from "../src/connectionPool.ts";

class MockEventSource {
  static instance: MockEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close() {}
  constructor() {
    MockEventSource.instance = this;
  }
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instance = null;
});

describe("useStellarPayment", () => {
  test("subscribes and exposes amountStroop as a bigint", () => {
    let hookResult: any = null;

    function TestComponent() {
      hookResult = useStellarPayment("https://events.example.com", "GABC");
      return null;
    }

    render(<TestComponent />);

    // Initially, no event is received, so event is null and amountStroop is null
    expect(hookResult.event).toBeNull();
    expect(hookResult.amountStroop).toBeNull();
    expect(hookResult.connected).toBe(false);

    // Simulate connection open
    act(() => {
      MockEventSource.instance?.onopen?.();
    });
    expect(hookResult.connected).toBe(true);

    // Simulate incoming payment event
    const mockEvent = {
      type: "payment.received",
      amount: "12.3456789",
      asset: "XLM",
      from: "GABC_SENDER",
      to: "GABC",
      timestamp: "2026-01-01T00:00:00Z",
    };

    act(() => {
      MockEventSource.instance?.onmessage?.({
        data: JSON.stringify(mockEvent),
      });
    });

    // Check that event is correctly set and amountStroop is parsed correctly as bigint
    expect(hookResult.event).toEqual(mockEvent);
    expect(hookResult.amountStroop).toBe(123456789n);

    // Simulate incoming payment event with different decimal places
    const mockEvent2 = {
      type: "payment.received",
      amount: "0.0000001",
      asset: "XLM",
      from: "GABC_SENDER",
      to: "GABC",
      timestamp: "2026-01-01T00:00:01Z",
    };

    act(() => {
      MockEventSource.instance?.onmessage?.({
        data: JSON.stringify(mockEvent2),
      });
    });

    expect(hookResult.event).toEqual(mockEvent2);
    expect(hookResult.amountStroop).toBe(1n);
  });
});
