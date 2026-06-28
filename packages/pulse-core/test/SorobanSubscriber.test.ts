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
