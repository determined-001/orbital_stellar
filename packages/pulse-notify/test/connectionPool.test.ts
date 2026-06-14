import { beforeAll, afterAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
  acquireEventConnection,
} from "../src/connectionPool.ts";

type EventSourceMessageHandler = (message: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: EventSourceMessageHandler | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closeCount += 1;
  }
}

let originalEventSource: typeof globalThis.EventSource;

beforeAll(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterAll(() => {
  globalThis.EventSource = originalEventSource;
});

beforeEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
});

describe("connectionPool", () => {
  test("shares a single EventSource for identical connection keys", () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    const a = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsA.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    const b = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsB.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 1);
    assert.equal(__getConnectionPoolSizeForTests(), 1);
    assert.equal(a.connected, false);
    assert.equal(b.connected, false);

    MockEventSource.instances[0]?.onopen?.();
    assert.equal(a.connected, true);
    assert.equal(b.connected, true);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "payment.received" }),
    });

    assert.deepEqual(eventsA, ["payment.received"]);
    assert.deepEqual(eventsB, ["payment.received"]);
  });

  test("closes connection only after last subscriber unsubscribes", () => {
    const a = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    const b = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    a.unsubscribe();
    assert.equal(MockEventSource.instances[0]?.closeCount, 0);
    assert.equal(__getConnectionPoolSizeForTests(), 1);

    b.unsubscribe();
    assert.equal(MockEventSource.instances[0]?.closeCount, 1);
    assert.equal(__getConnectionPoolSizeForTests(), 0);
  });

  test("uses separate connections for different tokens", () => {
    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 2);
    assert.equal(__getConnectionPoolSizeForTests(), 2);
  });
});
