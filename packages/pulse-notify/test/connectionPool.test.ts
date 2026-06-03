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
  }
);

const second = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
  {
    onOpen: () => undefined,
    onEvent: (event) => secondEvents.push(event.type),
    onParseError: () => undefined,
    onError: () => undefined,
  }
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
  }
);
const withToken = acquireEventConnection(
  { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
  {
    onOpen: () => undefined,
    onEvent: () => undefined,
    onParseError: () => undefined,
    onError: () => undefined,
  }
);

assert.equal(MockEventSource.instances.length, 3);
assert.equal(__getConnectionPoolSizeForTests(), 2);

withoutToken.unsubscribe();
withToken.unsubscribe();
reset();
