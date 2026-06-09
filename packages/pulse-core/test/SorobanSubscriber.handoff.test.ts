import { expect, describe, it, beforeEach } from "vitest";
import { SorobanRpcError } from "../src/errors.js";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";
import { FakeSorobanRpc } from "./fakes/FakeSorobanRpc.js";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";

// --- Self-Contained In-Memory Cursor Store Implementation ---
export class MemoryCursorStore {
  private cursor: string | undefined = undefined;

  async getCursor(): Promise<string | undefined> {
    return this.cursor;
  }

  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

// --- Complete 4 Scenario Invariant Handoff Test Suite ---
describe("SorobanSubscriber Handoff & Restart Resiliency", () => {
  let fakeRpc: FakeSorobanRpc;
  let cursorStore: MemoryCursorStore;
  let processedEvents: any[];

  beforeEach(() => {
    fakeRpc = new FakeSorobanRpc();
    cursorStore = new MemoryCursorStore();
    processedEvents = [];
  });

  const createSubscriber = () => {
    return new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore: cursorStore,
      onEvent: async (evt: any) => {
        processedEvents.push(evt);
      },
      pageSize: 100,
    });
  };

  it("Scenario 1: should maintain zero loss/duplicates on a clean shutdown", async () => {
    const subscriber = createSubscriber();
    await subscriber.pollOnce();
    expect(processedEvents.length).toBe(100);

    await subscriber.stop();

    const restartedSubscriber = createSubscriber();
    await restartedSubscriber.pollOnce();

    expect(processedEvents.length).toBe(200);

    for (let i = 0; i < 200; i++) {
      const expectedToken = (i + 1).toString().padStart(6, "0");
      expect(processedEvents[i].pagingToken).toBe(expectedToken);
    }
  });

  it("Scenario 2: should handle an abrupt kill without duplicating or losing state", async () => {
    const subscriber = createSubscriber();
    await subscriber.pollOnce();
    expect(processedEvents.length).toBe(100);

    const restartedSubscriber = createSubscriber();
    await restartedSubscriber.pollOnce();

    expect(processedEvents.length).toBe(200);
  });

  it("Scenario 3: should recover correctly if interrupted mid-poll by an RPC error", async () => {
    const subscriber = createSubscriber();

    fakeRpc.getEvents = async () => {
      throw new SorobanRpcError("Soroban RPC Network Timeout", {
        code: "network",
        retryable: true,
      });
    };

    try {
      await subscriber.pollOnce();
    } catch {
      // Caught network drop safely
    }

    const healthyRpc = new FakeSorobanRpc();
    fakeRpc.getEvents = healthyRpc.getEvents.bind(healthyRpc);

    const restartedSubscriber = createSubscriber();
    await restartedSubscriber.pollOnce();

    expect(processedEvents.length).toBe(100);
  });

  it("Scenario 4: should handle termination after processing exactly one event in a page", async () => {
    const localProcessedEvents: any[] = [];

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore: cursorStore,
      onEvent: async (evt: any) => {
        localProcessedEvents.push(evt);
        processedEvents.push(evt);
        await subscriber.stop();
      },
      pageSize: 100,
    });

    await subscriber.pollOnce();
    expect(localProcessedEvents.length).toBe(1);

    const restartedSubscriber = createSubscriber();
    await restartedSubscriber.pollOnce();

    expect(processedEvents.length).toBe(101);
  });

  it("schedules a retry for retryable SorobanRpcError without parsing messages", async () => {
    const retryableError = new SorobanRpcError("any message is fine", {
      code: "server",
      retryable: true,
      status: 503,
    });
    const retryableErrors: SorobanRpcError[] = [];
    const terminalErrors: unknown[] = [];
    const scheduledCallbacks: Array<() => void> = [];

    fakeRpc.getEvents = async () => {
      throw retryableError;
    };

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt: any) => {
        processedEvents.push(evt);
      },
      pageSize: 100,
      retryDelayMs: 25,
      setTimeoutFn: ((callback: () => void) => {
        scheduledCallbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
      onRetryableError: (error) => retryableErrors.push(error),
      onTerminalError: (error) => terminalErrors.push(error),
    });

    subscriber.start();
    await flushAsyncSubscriberWork();

    expect(retryableErrors).toEqual([retryableError]);
    expect(terminalErrors).toEqual([]);
    expect(scheduledCallbacks).toHaveLength(1);

    await subscriber.shutdown();
  });

  it("does not retry terminal SorobanRpcError", async () => {
    const terminalError = new SorobanRpcError("bad request", {
      code: "invalid_request",
      retryable: false,
      status: 400,
    });
    const retryableErrors: SorobanRpcError[] = [];
    const terminalErrors: unknown[] = [];
    const scheduledCallbacks: Array<() => void> = [];

    fakeRpc.getEvents = async () => {
      throw terminalError;
    };

    const subscriber = new SorobanSubscriber({
      rpc: fakeRpc,
      cursorStore,
      onEvent: async (evt: any) => {
        processedEvents.push(evt);
      },
      pageSize: 100,
      setTimeoutFn: ((callback: () => void) => {
        scheduledCallbacks.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
      onRetryableError: (error) => retryableErrors.push(error),
      onTerminalError: (error) => terminalErrors.push(error),
    });

    subscriber.start();
    await flushAsyncSubscriberWork();

    expect(retryableErrors).toEqual([]);
    expect(terminalErrors).toEqual([terminalError]);
    expect(scheduledCallbacks).toHaveLength(0);

    await subscriber.shutdown();
  });
});
