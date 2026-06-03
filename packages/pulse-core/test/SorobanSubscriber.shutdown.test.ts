/**
 * SorobanSubscriber — graceful shutdown tests
 *
 * Verifies the guarantee: after `stop()` resolves, no further events are
 * emitted from the Soroban path, even when a `getEvents` call is in-flight
 * at the moment `stop()` is called.
 */
import { expect, describe, it, vi, beforeEach } from "vitest";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";
import { FakeSorobanRpc } from "./fakes/FakeSorobanRpc.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MemoryCursorStore {
  private cursor: string | undefined = undefined;

  async getCursor(): Promise<string | undefined> {
    return this.cursor;
  }

  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SorobanSubscriber — graceful shutdown", () => {
  let fakeRpc: FakeSorobanRpc;
  let cursorStore: MemoryCursorStore;
  let emittedEvents: unknown[];

  beforeEach(() => {
    fakeRpc = new FakeSorobanRpc();
    cursorStore = new MemoryCursorStore();
    emittedEvents = [];
  });

  it("stop() before pollOnce() — poll is a no-op and emits nothing", async () => {
    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    await subscriber.stop();
    await subscriber.pollOnce();

    expect(emittedEvents).toHaveLength(0);
    expect(fakeRpc.callCount).toBe(0);
  });

  it("stop() after pollOnce() completes — no further events on a second poll", async () => {
    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    await subscriber.pollOnce();
    const countAfterFirst = emittedEvents.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    await subscriber.stop();

    // A second poll must be a no-op.
    await subscriber.pollOnce();
    expect(emittedEvents).toHaveLength(countAfterFirst);
  });

  it("stop() while getEvents is in-flight — aborts the request and emits nothing", async () => {
    const { promise: stallPromise, resolve: releaseStall } = makeDeferred();
    fakeRpc.stallUntil = stallPromise;

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    // Start a poll — it will block inside getEvents waiting for stallPromise.
    const pollPromise = subscriber.pollOnce();

    // Stop the subscriber while the poll is stalled.
    const stopPromise = subscriber.stop();

    // Release the stall *after* stop() has been called.  The abort signal
    // should have already fired, so getEvents should reject with AbortError.
    releaseStall();

    // Both promises must settle cleanly.
    await Promise.all([pollPromise, stopPromise]);

    // No events should have been delivered.
    expect(emittedEvents).toHaveLength(0);
  });

  it("stop() while getEvents is in-flight — stop() resolves only after the poll settles", async () => {
    const { promise: stallPromise, resolve: releaseStall } = makeDeferred();
    fakeRpc.stallUntil = stallPromise;

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    const order: string[] = [];

    const pollPromise = subscriber.pollOnce().then(() => {
      order.push("poll-settled");
    });

    // Give the poll a tick to start and enter the stalled getEvents call.
    await Promise.resolve();

    const stopPromise = subscriber.stop().then(() => {
      order.push("stop-resolved");
    });

    releaseStall();
    await Promise.all([pollPromise, stopPromise]);

    // stop() must not resolve before the in-flight poll settles.
    expect(order).toEqual(["poll-settled", "stop-resolved"]);
  });

  it("stop() called from within onEvent — remaining events in the page are dropped", async () => {
    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
        // Stop after the very first event.
        await subscriber.stop();
      },
      pageSize: 10,
    });

    await subscriber.pollOnce();

    // Only the first event should have been delivered.
    expect(emittedEvents).toHaveLength(1);
  });

  it("stop() is idempotent — calling it multiple times does not throw", async () => {
    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    await expect(
      Promise.all([subscriber.stop(), subscriber.stop(), subscriber.stop()])
    ).resolves.not.toThrow();
  });

  it("RPC errors other than AbortError are re-thrown", async () => {
    const networkError = new Error("Soroban RPC Network Timeout");
    fakeRpc.getEvents = async () => {
      throw networkError;
    };

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt) => {
        emittedEvents.push(evt);
      },
    });

    await expect(subscriber.pollOnce()).rejects.toThrow(
      "Soroban RPC Network Timeout"
    );
    expect(emittedEvents).toHaveLength(0);
  });
});
