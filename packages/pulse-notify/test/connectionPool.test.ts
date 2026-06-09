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
  readyState: number = EventSource.CONNECTING;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
    this.readyState = EventSource.CONNECTING;
    // Simulate immediate open
    setImmediate(() => {
      if (this.readyState === EventSource.CONNECTING) {
        this.readyState = EventSource.OPEN;
        this.onopen?.();
      }
    });
  }

  close() {
    this.closeCount += 1;
    this.readyState = EventSource.CLOSED;
  }
}

globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

function reset() {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
}

reset();

const firstEvents: string[] = [];
const secondEvents: string[] = [];

const first = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
  {
    onOpen: () => undefined,
    onEvent: (event) => firstEvents.push(event.type),
    onParseError: () => undefined,
    onError: () => undefined,
  },
);

const second = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
  {
    onOpen: () => undefined,
    onEvent: (event) => secondEvents.push(event.type),
    onParseError: () => undefined,
    onError: () => undefined,
  },
);

assert.equal(MockEventSource.instances.length, 1);
assert.equal(__getConnectionPoolSizeForTests(), 1);

assert.equal(first.connected, false);
assert.equal(second.connected, false);
MockEventSource.instances[0]?.onopen?.();
assert.equal(first.connected, true);
assert.equal(second.connected, true);

MockEventSource.instances[0]?.onmessage?.({
  data: JSON.stringify({ type: "payment.received" }),
});

assert.deepEqual(firstEvents, ["payment.received"]);
assert.deepEqual(secondEvents, ["payment.received"]);

first.unsubscribe();
assert.equal(MockEventSource.instances[0]?.closeCount, 0);
assert.equal(__getConnectionPoolSizeForTests(), 1);

second.unsubscribe();
assert.equal(MockEventSource.instances[0]?.closeCount, 1);
assert.equal(__getConnectionPoolSizeForTests(), 0);

const withoutToken = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC" },
  {
    onOpen: () => undefined,
    onEvent: () => undefined,
    onParseError: () => undefined,
    onError: () => undefined,
  },
);
const withToken = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
  {
    onOpen: () => undefined,
    onEvent: () => undefined,
    onParseError: () => undefined,
    onError: () => undefined,
  },
);

assert.equal(MockEventSource.instances.length, 3);
assert.equal(__getConnectionPoolSizeForTests(), 2);

withoutToken.unsubscribe();
withToken.unsubscribe();
reset();

// Test close() and reopenIfClosed() methods for visibility pausing
const errorCalls: number[] = [];
const openCalls: number[] = [];

const conn = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC" },
  {
    onOpen: () => {
      openCalls.push(openCalls.length);
    },
    onEvent: () => undefined,
    onParseError: () => undefined,
    onError: () => {
      errorCalls.push(errorCalls.length);
    },
  },
);

assert.equal(MockEventSource.instances.length, 1);
const source1 = MockEventSource.instances[0]!;

// Close the connection (simulating tab hidden)
conn.close();
assert.equal(source1.closeCount, 1);
assert.equal(errorCalls.length, 1); // onError was called
assert.equal(source1.readyState, EventSource.CLOSED);

// Reopen the connection (simulating tab visible again)
conn.reopenIfClosed();
assert.equal(MockEventSource.instances.length, 2); // New EventSource created
const source2 = MockEventSource.instances[1]!;
assert.equal(source2.readyState, EventSource.CONNECTING);

// Verify old source wasn't called again
assert.equal(source1.closeCount, 1);

conn.unsubscribe();
reset();
