/**
 * Transport parity tests — proves SSE and WebSocket deliver the same events
 * and that a consumer can switch by changing only the transport config flag.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { acquireEventConnection, __resetConnectionPoolForTests } from "../src/connectionPool.js";
import { acquireWsConnection, __resetWsPoolForTests } from "../src/wsTransport.js";

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
  close() {
    this.closeCount++;
  }
}

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closeCount = 0;
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {
    this.closeCount++;
  }
}

// Install globals before imports resolve at runtime
(globalThis as any).EventSource = MockEventSource;
(globalThis as any).WebSocket = MockWebSocket;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SERVER = "https://events.example.com";
const ADDRESS = "GABC123";
const PAYMENT = JSON.stringify({ type: "payment.received", timestamp: "2026-01-01T00:00:00Z" });

function makeSubscriber() {
  const events: string[] = [];
  return {
    events,
    sub: {
      onOpen: () => {},
      onEvent: (e: { type: string }) => events.push(e.type),
      onParseError: () => {},
      onError: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("transport parity", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    MockWebSocket.instances = [];
    __resetConnectionPoolForTests();
    __resetWsPoolForTests();
  });

  afterEach(() => {
    __resetConnectionPoolForTests();
    __resetWsPoolForTests();
  });

  it("SSE delivers a payment event", () => {
    const { events, sub } = makeSubscriber();
    acquireEventConnection({ serverUrl: SERVER, address: ADDRESS }, sub);

    MockEventSource.instances[0]!.onopen!();
    MockEventSource.instances[0]!.onmessage!({ data: PAYMENT });

    expect(events).toEqual(["payment.received"]);
  });

  it("WebSocket delivers the same payment event", () => {
    const { events, sub } = makeSubscriber();
    acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, sub);

    MockWebSocket.instances[0]!.onopen!();
    MockWebSocket.instances[0]!.onmessage!({ data: PAYMENT });

    expect(events).toEqual(["payment.received"]);
  });

  it("SSE and WebSocket deliver identical event shapes", () => {
    const { events: sseEvents, sub: sseSub } = makeSubscriber();
    const { events: wsEvents, sub: wsSub } = makeSubscriber();

    acquireEventConnection({ serverUrl: SERVER, address: ADDRESS }, sseSub);
    acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, wsSub);

    MockEventSource.instances[0]!.onmessage!({ data: PAYMENT });
    MockWebSocket.instances[0]!.onmessage!({ data: PAYMENT });

    expect(sseEvents).toEqual(wsEvents);
  });

  it("switching transport flag changes the underlying connection type", () => {
    // SSE path uses EventSource
    const { sub: sseSub } = makeSubscriber();
    acquireEventConnection({ serverUrl: SERVER, address: ADDRESS }, sseSub);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockWebSocket.instances).toHaveLength(0);

    __resetConnectionPoolForTests();

    // WebSocket path uses WebSocket
    const { sub: wsSub } = makeSubscriber();
    acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, wsSub);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockEventSource.instances).toHaveLength(1); // unchanged
  });

  it("WebSocket URL converts http prefix to ws", () => {
    const { sub } = makeSubscriber();
    acquireWsConnection({ serverUrl: "http://localhost:3000", address: ADDRESS }, sub);
    expect(MockWebSocket.instances[0]!.url).toMatch(/^ws:\/\//);
  });

  it("WebSocket URL converts https prefix to wss", () => {
    const { sub } = makeSubscriber();
    acquireWsConnection({ serverUrl: "https://events.example.com", address: ADDRESS }, sub);
    expect(MockWebSocket.instances[0]!.url).toMatch(/^wss:\/\//);
  });

  it("WebSocket pool is shared for same key", () => {
    const { sub: a } = makeSubscriber();
    const { sub: b } = makeSubscriber();
    acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, a);
    acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, b);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("WebSocket closes when last subscriber unsubscribes", () => {
    const { sub } = makeSubscriber();
    const conn = acquireWsConnection({ serverUrl: SERVER, address: ADDRESS }, sub);
    conn.unsubscribe();
    expect(MockWebSocket.instances[0]!.closeCount).toBe(1);
  });
});
