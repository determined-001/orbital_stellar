import { render, act, cleanup } from "@testing-library/react";
import { afterEach, expect, test, describe } from "vitest";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
} from "../src/connectionPool.ts";
import { useStellarAddresses } from "../src/index.ts";

// ── Minimal EventSource stub ──────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closeCount = 0;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
    // Auto-open on next tick (mirrors other hook tests in this package).
    setTimeout(() => this.onopen?.(), 0);
  }

  close() {
    this.closeCount++;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
  cleanup();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const SERVER = "https://events.example.com";

function makeAddresses(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `GADDR${i + 1}`);
}

// Simple component that renders the connection count and each address state.
function WatcherComponent({
  addresses,
  onEvent,
}: {
  addresses: string[];
  onEvent?: (addr: string, ev: unknown) => void;
}) {
  const states = useStellarAddresses(SERVER, addresses, { onEvent });
  return (
    <div>
      {addresses.map((addr, i) => (
        <div key={`${addr}-${i}`} data-testid={addr}>
          {states[addr]?.connected ? "connected" : "disconnected"}|
          {states[addr]?.event ? JSON.stringify(states[addr]!.event) : "null"}|
          {states[addr]?.error ?? "none"}
        </div>
      ))}
    </div>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useStellarAddresses", () => {
  test("opens one EventSource per unique address", async () => {
    const addresses = makeAddresses(5);
    const { unmount } = render(<WatcherComponent addresses={addresses} />);

    // Wait for all five EventSources to auto-open.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Each unique address = one connection in the pool.
    expect(MockEventSource.instances.length).toBe(5);
    expect(__getConnectionPoolSizeForTests()).toBe(5);

    unmount();
  });

  test("duplicate addresses share one underlying EventSource", async () => {
    // Pass the same address three times — pool must coalesce to 1 connection.
    const addr = "GSHARED";
    const addresses = [addr, addr, addr];
    const { unmount } = render(<WatcherComponent addresses={addresses} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Three subscriptions, but the pool only opens one EventSource.
    expect(MockEventSource.instances.length).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    unmount();
  });

  test("returns connected state per address after open", async () => {
    const addresses = makeAddresses(2);
    const { getByTestId, findByText } = render(<WatcherComponent addresses={addresses} />);

    // Wait for first address to connect.
    await findByText(/connected/, { selector: `[data-testid="${addresses[0]}"]` });

    expect(getByTestId(addresses[0]!).textContent).toContain("connected");
    expect(getByTestId(addresses[1]!).textContent).toContain("connected");
  });

  test("delivers events to the correct address slot", async () => {
    const [addr1, addr2] = makeAddresses(2);
    const received: { addr: string; type: string }[] = [];

    const { getByTestId, findByText } = render(
      <WatcherComponent
        addresses={[addr1!, addr2!]}
        onEvent={(addr, ev) => received.push({ addr, type: (ev as { type: string }).type })}
      />,
    );

    await findByText(/connected/, { selector: `[data-testid="${addr1}"]` });

    // Fire an event on the second EventSource (addr2 maps to instances[1]).
    act(() => {
      MockEventSource.instances[1]!.emit({
        type: "payment.received",
        address: addr2,
        amount: "10.0000000",
        asset: "XLM",
        timestamp: "2026-06-27T10:00:00Z",
      });
    });

    expect(getByTestId(addr2!).textContent).toContain("payment.received");
    // addr1 slot must remain unaffected.
    expect(getByTestId(addr1!).textContent).toContain("|null|");
    expect(received).toHaveLength(1);
    expect(received[0]!.addr).toBe(addr2);
  });

  test("cleans up all connections on unmount", async () => {
    const addresses = makeAddresses(5);
    const { unmount } = render(<WatcherComponent addresses={addresses} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(__getConnectionPoolSizeForTests()).toBe(5);

    unmount();

    // Pool must be empty — every EventSource closed.
    expect(__getConnectionPoolSizeForTests()).toBe(0);
    expect(MockEventSource.instances.every((es) => es.closeCount === 1)).toBe(true);
  });

  test("five addresses use at most one EventSource when all are identical", async () => {
    // This is the literal 'Done when' criterion from issue #693.
    const shared = "GSHAREDWALLET";
    const addresses = Array.from({ length: 5 }, () => shared);
    const { unmount } = render(<WatcherComponent addresses={addresses} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // All five 'subscriptions' must coalesce into exactly 1 EventSource.
    expect(MockEventSource.instances.length).toBe(1);

    unmount();
  });
});
