import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import {
  SorobanSubscriber,
  type CursorStoreLike,
  type SorobanEvent,
} from "../src/SorobanSubscriber.js";
import type {
  SorobanGetEventsParams,
  SorobanGetEventsResult,
  SorobanRpcCallOptions,
  SorobanRpcEvent,
} from "../src/SorobanRpcClient.js";
import { SorobanRpcError } from "../src/errors.js";

class MemoryCursorStore implements CursorStoreLike {
  constructor(public cursor?: string) {}

  async getCursor(): Promise<string | undefined> {
    return this.cursor;
  }

  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

class PollingRpc {
  readonly getLatestLedger = vi.fn(async (_options?: SorobanRpcCallOptions) => 120);
  readonly calls: SorobanGetEventsParams[] = [];
  private responseIndex = 0;

  constructor(private readonly responses: SorobanGetEventsResult[]) {}

  async getEvents(
    params: SorobanGetEventsParams,
    _options?: SorobanRpcCallOptions,
  ): Promise<SorobanGetEventsResult> {
    this.calls.push(structuredClone(params));
    const response = this.responses[this.responseIndex];
    this.responseIndex++;
    return response ?? { events: [], cursor: `cursor-${this.responseIndex}` };
  }
}

function rawEvent(id = "event-1"): SorobanRpcEvent & SorobanEvent {
  return {
    id,
    pagingToken: `${id}-paging-token`,
    type: "contract",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    topic: ["transfer"],
    value: { amount: "10" },
    ledger: 115,
    ledgerClosedAt: "2026-06-27T12:00:00Z",
    txHash: "abc123",
    inSuccessfulContractCall: true,
  };
}

async function flushPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("SorobanSubscriber startLedger to cursor polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses latest ledger minus lookback once, then the previous response cursor", async () => {
    const rpc = new PollingRpc([
      { events: [rawEvent()], cursor: "cursor-1", latestLedger: 120 },
      { events: [], cursor: "cursor-2", latestLedger: 121 },
    ]);
    const cursorStore = new MemoryCursorStore();
    const emitted: SorobanEvent[] = [];
    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore,
      startLedgerLookback: 5,
      pollIntervalMs: 500,
      pageLimit: 250,
      onEvent: async (event) => {
        emitted.push(event);
      },
    });

    subscriber.start();
    await flushPoll();

    expect(rpc.getLatestLedger).toHaveBeenCalledTimes(1);
    expect(rpc.calls[0]).toEqual({
      startLedger: 115,
      pagination: { limit: 250 },
      xdrFormat: "json",
    });
    expect(emitted[0]).toMatchObject({
      id: "event-1",
      type: "contract.emitted",
      decodedData: { amount: "10" },
    });
    expect(cursorStore.cursor).toBe("cursor-1");

    await vi.advanceTimersByTimeAsync(500);
    await flushPoll();

    expect(rpc.getLatestLedger).toHaveBeenCalledTimes(1);
    expect(rpc.calls[1]).toEqual({
      pagination: { cursor: "cursor-1", limit: 250 },
      xdrFormat: "json",
    });
    expect(cursorStore.cursor).toBe("cursor-2");

    await subscriber.stop();
  });

  it("resumes from a persisted cursor without requesting the latest ledger", async () => {
    const rpc = new PollingRpc([{ events: [], cursor: "cursor-next" }]);
    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore("cursor-saved"),
    });

    await subscriber.pollOnce();

    expect(rpc.getLatestLedger).not.toHaveBeenCalled();
    expect(rpc.calls[0]).toEqual({
      pagination: { cursor: "cursor-saved", limit: 100 },
      xdrFormat: "json",
    });
  });

  it("uses the default two-second interval and stops without another poll", async () => {
    const rpc = new PollingRpc([{ events: [], cursor: "cursor-1" }]);
    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore(),
    });

    subscriber.start();
    await flushPoll();
    expect(rpc.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(rpc.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPoll();
    expect(rpc.calls).toHaveLength(2);

    await subscriber.stop();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(rpc.calls).toHaveLength(2);
  });

  it("wires EventEngine start and stop to the configured subscriber", async () => {
    const requests: Array<{ method: string; params?: SorobanGetEventsParams }> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: SorobanGetEventsParams;
      };
      requests.push({ method: body.method, params: body.params });
      const result =
        body.method === "getLatestLedger"
          ? { sequence: 200 }
          : body.method === "getNetwork"
            ? { passphrase: "Test SDF Network ; September 2015", protocolVersion: 22 }
            : { events: [], cursor: `engine-cursor-${requests.length}` };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = new EventEngine({
      network: "testnet",
      soroban: {
        rpcUrl: "https://rpc.example",
        pollIntervalMs: 250,
        startLedgerLookback: 10,
      },
    });
    (engine as any).server = {
      operations: () => ({
        cursor: () => ({
          stream: () => () => {},
        }),
      }),
    };

    engine.start();
    await flushPoll();
    expect(requests.map((request) => request.method)).toEqual([
      "getNetwork",
      "getLatestLedger",
      "getEvents",
    ]);
    expect(requests[2]?.params).toMatchObject({
      startLedger: 190,
      pagination: { limit: 100 },
    });

    await vi.advanceTimersByTimeAsync(250);
    await flushPoll();
    expect(requests.filter((request) => request.method === "getEvents")).toHaveLength(2);

    engine.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests.filter((request) => request.method === "getEvents")).toHaveLength(2);
  });
});

describe("SorobanSubscriber reconnection and rate-limit handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeNetworkError(): SorobanRpcError {
    return new SorobanRpcError("network failure", { code: "network", retryable: true });
  }

  function makeRateLimitError(retryAfterMs?: number): SorobanRpcError {
    return new SorobanRpcError("rate limited", {
      code: "rate_limit",
      retryable: true,
      status: 429,
      retryAfterMs,
    });
  }

  function makeRpc(responses: Array<SorobanGetEventsResult | SorobanRpcError>) {
    let i = 0;
    return {
      getLatestLedger: vi.fn(async () => 100),
      getEvents: vi.fn(async (_params: SorobanGetEventsParams, _opts?: SorobanRpcCallOptions) => {
        const r = responses[i++];
        if (r instanceof SorobanRpcError) throw r;
        return r ?? { events: [], cursor: `c-${i}` };
      }),
    };
  }

  it("emits engine.reconnecting with Full-Jitter delay on network error, then engine.reconnected on success", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const rpc = makeRpc([makeNetworkError(), { events: [], cursor: "c-2" }]);

    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore("cursor-a"),
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
    });

    const reconnecting: unknown[] = [];
    const reconnected: unknown[] = [];
    subscriber.on("engine.reconnecting", (p) => reconnecting.push(p));
    subscriber.on("engine.reconnected", (p) => reconnected.push(p));

    // First poll throws a network error
    const poll1 = subscriber.pollOnce();
    await flushPoll();
    await poll1;

    expect(reconnecting).toHaveLength(1);
    expect(reconnecting[0]).toMatchObject({
      type: "engine.reconnecting",
      attempt: 1,
      source: "soroban",
      cursor: "cursor-a",
    });
    // Full-Jitter: Math.floor(0.5 * min(1000 * 2^0, 30000)) = Math.floor(0.5 * 1000) = 500
    expect((reconnecting[0] as any).delayMs).toBe(500);
    expect(reconnected).toHaveLength(0);

    // Advance past retry delay so the retry fires
    await vi.advanceTimersByTimeAsync(500);
    await flushPoll();
    await flushPoll();

    expect(reconnected).toHaveLength(1);
    expect(reconnected[0]).toMatchObject({
      type: "engine.reconnected",
      attempt: 1,
      source: "soroban",
    });

    await subscriber.stop();
  });

  it("emits engine.rate_limited with Retry-After delay on HTTP 429", async () => {
    const rpc = makeRpc([makeRateLimitError(5_000), { events: [], cursor: "c-2" }]);

    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore("cursor-b"),
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
    });

    const rateLimited: unknown[] = [];
    const reconnected: unknown[] = [];
    subscriber.on("engine.rate_limited", (p) => rateLimited.push(p));
    subscriber.on("engine.reconnected", (p) => reconnected.push(p));

    const poll1 = subscriber.pollOnce();
    await flushPoll();
    await poll1;

    expect(rateLimited).toHaveLength(1);
    expect(rateLimited[0]).toMatchObject({
      type: "engine.rate_limited",
      attempt: 1,
      delayMs: 5_000,
      source: "soroban",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPoll();
    await flushPoll();

    expect(reconnected).toHaveLength(1);
    expect(reconnected[0]).toMatchObject({ type: "engine.reconnected", attempt: 1 });

    await subscriber.stop();
  });

  it("uses 60s fallback delay when 429 has no Retry-After", async () => {
    const rpc = makeRpc([makeRateLimitError(undefined)]);

    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore(),
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
    });

    const rateLimited: unknown[] = [];
    subscriber.on("engine.rate_limited", (p) => rateLimited.push(p));

    const poll1 = subscriber.pollOnce();
    await flushPoll();
    await poll1;

    expect(rateLimited[0]).toMatchObject({ delayMs: 60_000 });
    await subscriber.stop();
  });

  it("resets reconnectAttempt after successful poll", async () => {
    const rpc = makeRpc([
      makeNetworkError(),
      makeNetworkError(),
      { events: [], cursor: "c-3" },
      makeNetworkError(),
    ]);

    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore(),
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
    });

    const reconnecting: unknown[] = [];
    subscriber.on("engine.reconnecting", (p) => reconnecting.push(p));

    // Call pollOnce directly to drive each poll without timer interference
    await subscriber.pollOnce(); // error → attempt 1
    await subscriber.pollOnce(); // error → attempt 2
    await subscriber.pollOnce(); // success → resets to 0
    await subscriber.pollOnce(); // error → attempt 1 (fresh counter)

    const attempts = reconnecting.map((p) => (p as any).attempt);
    expect(attempts[0]).toBe(1);
    expect(attempts[1]).toBe(2);
    // After successful poll reset, next failure starts from 1 again
    expect(attempts[2]).toBe(1);

    await subscriber.stop();
  });

  it("stops retrying once maxRetries is exceeded and calls onTerminalError", async () => {
    const rpc = makeRpc([makeNetworkError(), makeNetworkError(), makeNetworkError()]);

    const terminalErrors: unknown[] = [];
    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore: new MemoryCursorStore(),
      initialDelayMs: 1,
      maxDelayMs: 10,
      maxRetries: 2,
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
      onTerminalError: (err) => terminalErrors.push(err),
    });

    // First poll fails → attempt 1 (within maxRetries=2, schedules retry)
    await subscriber.pollOnce();
    await vi.advanceTimersByTimeAsync(10);
    await flushPoll();
    // Retry fires → attempt 2 (within maxRetries=2, schedules retry)
    await vi.advanceTimersByTimeAsync(10);
    await flushPoll();
    // Retry fires → attempt 3 > maxRetries → calls onTerminalError, no more retry
    await vi.advanceTimersByTimeAsync(10);
    await flushPoll();

    expect(terminalErrors).toHaveLength(1);
    expect(terminalErrors[0]).toBeInstanceOf(SorobanRpcError);

    await subscriber.stop();
  });
});
