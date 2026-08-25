import { describe, it, expect } from "vitest";
import { EventEngine } from "../src/EventEngine.js";

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
const CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

function engine(): EventEngine {
  return new EventEngine({ horizonUrl: "https://horizon-testnet.stellar.org" });
}

/** Counts events a subscriber actually receives. */
function collect(watcher: ReturnType<EventEngine["subscribe"]>, eventType: string): unknown[] {
  const seen: unknown[] = [];
  watcher.on(eventType, (event) => seen.push(event));
  return seen;
}

describe("subscribe() reference counting", () => {
  it("hands concurrent callers the same shared Watcher", () => {
    const e = engine();
    expect(e.subscribe(ADDRESS)).toBe(e.subscribe(ADDRESS));
  });

  it("regression (MEDIUM-4): one caller unsubscribing does not silence the others", () => {
    // Two HTTP clients streaming the same address. Before ref counting, client
    // A's teardown called stop() on the watcher they *shared*, which removed
    // B's listeners and made emit() a no-op - B's connection stayed open and
    // simply never delivered another event.
    const e = engine();
    const a = e.subscribe(ADDRESS);
    const b = e.subscribe(ADDRESS);
    const bReceived = collect(b, "payment.received");

    e.unsubscribe(ADDRESS); // client A disconnects

    expect(b.stopped).toBe(false);
    expect(a.stopped).toBe(false);
    b.emit("payment.received", { seq: 1 });
    expect(bReceived).toHaveLength(1);
  });

  it("stops the watcher once the last caller unsubscribes", () => {
    const e = engine();
    const w = e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);

    e.unsubscribe(ADDRESS);
    expect(w.stopped).toBe(false);

    e.unsubscribe(ADDRESS);
    expect(w.stopped).toBe(true);
  });

  it("still stops immediately for a single subscriber", () => {
    const e = engine();
    const w = e.subscribe(ADDRESS);
    e.unsubscribe(ADDRESS);
    expect(w.stopped).toBe(true);
  });

  it("does not carry a stale count into a fresh subscription", () => {
    const e = engine();
    const first = e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);
    e.unsubscribe(ADDRESS);
    e.unsubscribe(ADDRESS);
    expect(first.stopped).toBe(true);

    // A new subscription for the same address must start from zero, not
    // inherit the previous entry's count.
    const second = e.subscribe(ADDRESS);
    expect(second).not.toBe(first);
    e.unsubscribe(ADDRESS);
    expect(second.stopped).toBe(true);
  });

  it("tolerates unsubscribing more times than subscribed", () => {
    const e = engine();
    const w = e.subscribe(ADDRESS);
    e.unsubscribe(ADDRESS);
    expect(() => e.unsubscribe(ADDRESS)).not.toThrow();
    expect(w.stopped).toBe(true);
  });

  it("keeps counts independent per address", () => {
    const other = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const e = engine();
    const a = e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);
    const b = e.subscribe(other);

    e.unsubscribe(other);
    expect(b.stopped).toBe(true);
    expect(a.stopped).toBe(false);
  });

  it("unsubscribeAll tears down regardless of outstanding holders", () => {
    const e = engine();
    const w = e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);

    e.unsubscribeAll();
    expect(w.stopped).toBe(true);

    // The refcount entry must be gone too, or the next subscription would
    // start life already "held" and never stop.
    const fresh = e.subscribe(ADDRESS);
    e.unsubscribe(ADDRESS);
    expect(fresh.stopped).toBe(true);
  });

  it("clears counts when a watcher is stopped directly, bypassing unsubscribe", () => {
    const e = engine();
    const w = e.subscribe(ADDRESS);
    e.subscribe(ADDRESS);

    w.stop(); // consumer stopped the Watcher itself

    const fresh = e.subscribe(ADDRESS);
    expect(fresh).not.toBe(w);
    e.unsubscribe(ADDRESS);
    expect(fresh.stopped).toBe(true);
  });
});

describe("subscribeContract() reference counting", () => {
  it("regression (MEDIUM-4): shared contract watchers survive one caller leaving", () => {
    // Mirrors /api/contracts/[contractId], which keys every connection on the
    // same `contract:${contractId}` subscription id.
    const e = engine();
    const a = e.subscribeContract(`contract:${CONTRACT}`);
    const b = e.subscribeContract(`contract:${CONTRACT}`);
    expect(a).toBe(b);

    e.unsubscribeContract(`contract:${CONTRACT}`);
    expect(b.stopped).toBe(false);

    e.unsubscribeContract(`contract:${CONTRACT}`);
    expect(b.stopped).toBe(true);
  });

  it("reference counts config-based subscriptions by filter key", () => {
    const e = engine();
    const config = { filters: [{ contractIds: [CONTRACT] }] };
    const a = e.subscribeContract(config);
    const b = e.subscribeContract({ filters: [{ contractIds: [CONTRACT] }] });
    expect(a).toBe(b); // same canonical filter key

    e.unsubscribeContract(config);
    expect(a.stopped).toBe(false);

    e.unsubscribeContract(config);
    expect(a.stopped).toBe(true);
  });

  it("unsubscribeAllContracts tears down regardless of holders", () => {
    const e = engine();
    const w = e.subscribeContract(`contract:${CONTRACT}`);
    e.subscribeContract(`contract:${CONTRACT}`);

    e.unsubscribeAllContracts();
    expect(w.stopped).toBe(true);
  });
});
