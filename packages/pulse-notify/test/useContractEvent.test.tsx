import { StrictMode, useState } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, expect, test, describe } from "vitest";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
} from "../src/connectionPool.ts";
import { useContractEvent } from "../src/index.ts";

// Minimal EventSource stub that allows emitting events and tracking open/close
class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closeCount = 0;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
    // Auto-open in next tick
    setTimeout(() => this.onopen?.(), 0);
  }

  close() {
    this.closeCount++;
  }

  emit(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
  cleanup();
});

describe("useContractEvent Hook", () => {
  function TestComponent({
    topics,
    onEvent,
  }: {
    topics?: string[];
    onEvent?: (event: any) => void;
  }) {
    const { event, connected, error } = useContractEvent({
      serverUrl: "https://events.example.com",
      contractId: "C123",
      topics,
      onEvent,
    });
    return (
      <div>
        <div data-testid="connected">{connected ? "true" : "false"}</div>
        <div data-testid="error">{error ?? "none"}</div>
        <div data-testid="event">{event ? JSON.stringify(event) : "null"}</div>
      </div>
    );
  }

  test("subscribes and receives contract events", async () => {
    let receivedEvent: any = null;
    const { getByTestId, findByText } = render(
      <TestComponent
        onEvent={(e) => {
          receivedEvent = e;
        }}
      />,
    );

    // Wait for connection to open
    await findByText("true", { selector: '[data-testid="connected"]' });

    expect(MockEventSource.instances.length).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    // Emit event
    const payload = {
      type: "contract.invoked",
      contractId: "C123",
      function: "hello",
      args: [],
      timestamp: "2026-06-26T17:29:03Z",
    };

    act(() => {
      MockEventSource.instances[0].emit(payload);
    });

    expect(receivedEvent).toEqual(payload);
    expect(getByTestId("event").textContent).toContain("contract.invoked");
  });

  test("filters contract.emitted events by topics", async () => {
    const { getByTestId, findByText } = render(<TestComponent topics={["transfer"]} />);

    await findByText("true", { selector: '[data-testid="connected"]' });

    // Emit non-matching topic event
    act(() => {
      MockEventSource.instances[0].emit({
        type: "contract.emitted",
        contractId: "C123",
        topics: ["mint"],
        data: "minted",
        timestamp: "2026-06-26T17:29:03Z",
      });
    });

    expect(getByTestId("event").textContent).toBe("null");

    // Emit matching topic event
    const matchPayload = {
      type: "contract.emitted",
      contractId: "C123",
      topics: ["transfer", "owner"],
      data: "transferred",
      timestamp: "2026-06-26T17:29:03Z",
    };

    act(() => {
      MockEventSource.instances[0].emit(matchPayload);
    });

    expect(getByTestId("event").textContent).toContain("transferred");
  });
});
