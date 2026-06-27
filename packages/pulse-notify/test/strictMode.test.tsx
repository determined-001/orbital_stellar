import { StrictMode } from "react";
import { render, act } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
} from "../src/connectionPool.ts";
import { useStellarEvent } from "../src/index.ts";

// Minimal EventSource stub
class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor() {
    MockEventSource.instances.push(this);
  }

  close() {}
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
});

function Subscriber() {
  useStellarEvent("https://events.example.com", "GABC");
  return null;
}

function FilteredSubscriber(props: { event: string; testId: string }) {
  const state = useStellarEvent("https://events.example.com", "GABC", { event: props.event });
  return <div data-testid={props.testId}>{state.event?.type ?? "none"}</div>;
}

test("exactly one connection survives Strict Mode double-mount", () => {
  act(() => {
    render(
      <StrictMode>
        <Subscriber />
      </StrictMode>,
    );
  });

  expect(__getConnectionPoolSizeForTests()).toBe(1);
});

test("multiple hook instances share one EventSource and keep independent filters", () => {
  const view = render(
    <>
      <FilteredSubscriber event="payment.received" testId="payment" />
      <FilteredSubscriber event="trustline.added" testId="trustline" />
    </>,
  );

  expect(MockEventSource.instances).toHaveLength(1);
  expect(__getConnectionPoolSizeForTests()).toBe(1);

  act(() => {
    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" }),
    });
  });

  expect(view.getByTestId("payment").textContent).toBe("payment.received");
  expect(view.getByTestId("trustline").textContent).toBe("none");

  act(() => {
    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "trustline.added", timestamp: "2026-01-01T00:00:01Z" }),
    });
  });

  expect(view.getByTestId("payment").textContent).toBe("payment.received");
  expect(view.getByTestId("trustline").textContent).toBe("trustline.added");

  view.unmount();
  expect(__getConnectionPoolSizeForTests()).toBe(0);
});
