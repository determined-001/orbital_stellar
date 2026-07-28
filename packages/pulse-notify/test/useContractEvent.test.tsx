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

  test("validates event data against optional schema", async () => {
    const schema = {
      safeParse: (data: unknown) => {
        if (typeof data === "string" && data === "valid") {
          return { success: true as const, data };
        }
        return { success: false as const };
      },
    };

    // Use Component that passes schema
    function SchemaTestComponent() {
      const { event } = useContractEvent({
        serverUrl: "https://events.example.com",
        contractId: "C123",
        topics: ["test"],
        schema,
      });
      return <div data-testid="event">{event ? JSON.stringify(event) : "null"}</div>;
    }

    const { getByTestId, findByText } = render(<SchemaTestComponent />);

    await findByText("true", { selector: '[data-testid="connected"]' });

    // Emit invalid data - should be filtered out
    act(() => {
      MockEventSource.instances[0].emit({
        type: "contract.emitted",
        contractId: "C123",
        topics: ["test"],
        data: "invalid",
        timestamp: "2026-06-26T17:29:03Z",
      });
    });

    expect(getByTestId("event").textContent).toBe("null");

    // Emit valid data - should pass through
    act(() => {
      MockEventSource.instances[0].emit({
        type: "contract.emitted",
        contractId: "C123",
        topics: ["test"],
        data: "valid",
        timestamp: "2026-06-26T17:29:03Z",
      });
    });

    expect(getByTestId("event").textContent).toContain("valid");
  });

  test("shares one connection per (contractId, event) regardless of hook-instance count", async () => {
    function HookInstance({ id }: { id: string }) {
      useContractEvent({
        serverUrl: "https://events.example.com",
        contractId: "C123",
        topics: ["transfer"],
      });
      return <div data-testid={`instance-${id}`}>{id}</div>;
    }

    const { findByText } = render(
      <div>
        <HookInstance id="a" />
        <HookInstance id="b" />
        <HookInstance id="c" />
      </div>,
    );

    // Wait for all instances to connect
    await findByText("a", { selector: '[data-testid="instance-a"]' });
    await findByText("b", { selector: '[data-testid="instance-b"]' });
    await findByText("c", { selector: '[data-testid="instance-c"]' });

    // Should only have one EventSource for all three hook instances
    // because they share the same serverUrl, contractId, topics, and token
    expect(MockEventSource.instances.length).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(1);
  });

  test("subscription count returns to zero after all instances unmount", async () => {
    function MountedHook() {
      useContractEvent({
        serverUrl: "https://events.example.com",
        contractId: "C123",
      });
      return <div data-testid="mounted">mounted</div>;
    }

    const { getByTestId, findByText, unmount } = render(<MountedHook />);
    await findByText("mounted", { selector: '[data-testid="mounted"]' });

    // Connection should exist while mounted
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    // Track the close count before unmount
    const es = MockEventSource.instances[0];
    const closeCountBefore = es.closeCount;

    // Unmount the component - subscription should go to zero
    unmount();

    // After unmount, the EventSource should have been closed
    expect(es.closeCount).toBe(closeCountBefore + 1);
    expect(__getConnectionPoolSizeForTests()).toBe(0);
  });
});
