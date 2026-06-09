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
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close() {}
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

afterEach(() => {
  __resetConnectionPoolForTests();
});

function Subscriber() {
  useStellarEvent("https://events.example.com", "GABC");
  return null;
}

test("exactly one connection survives Strict Mode double-mount", () => {
  act(() => {
    render(
      <StrictMode>
        <Subscriber />
      </StrictMode>
    );
  });

  expect(__getConnectionPoolSizeForTests()).toBe(1);
});
