import { expect, describe, it, beforeEach, vi, afterEach } from "vitest";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

vi.mock("../src/SorobanRpcClient.js", () => {
  return {
    SorobanRpcClient: vi.fn(function () {}),
  };
});

const tick = () => vi.advanceTimersByTimeAsync(0);

describe("SorobanSubscriber", () => {
  let mockClient: any;
  let onEvent: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      request: vi.fn().mockImplementation((method: string) => {
        if (method === "getLatestLedger") return Promise.resolve({ result: { sequence: 100 } });
        if (method === "getEvents") return Promise.resolve({ result: { latestLedger: 100, events: [] } });
        return Promise.resolve({ result: {} });
      }),
    };
    (SorobanRpcClient as any).mockImplementation(function () {
      return mockClient;
    });
    onEvent = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("should initialize with startLedger and emit normalized events", async () => {
    mockClient.request.mockImplementation((method: string, params: any) => {
      if (method === "getLatestLedger") return Promise.resolve({ result: { sequence: 100 } });
      if (method === "getEvents") {
        return Promise.resolve({
          result: {
            latestLedger: 100,
            events: [
              {
                id: "1",
                pagingToken: "token1",
                contractId: "C1",
                type: "contract",
                topic: ["t1"],
                value: "v1",
                ledger: 100,
                ledgerClosedAt: "2023-01-01T00:00:00Z",
                txHash: "0000000000000000000000000000000000000000000000000000000000000000",
              },
            ],
          },
        });
      }
    });

    const subscriber = new SorobanSubscriber({
      rpcUrl: "http://localhost",
      pollIntervalMs: 2000,
      onEvent,
    });

    subscriber.start();
    await tick();

    expect(mockClient.request).toHaveBeenCalledWith("getLatestLedger");
    expect(mockClient.request).toHaveBeenCalledWith("getEvents", { startLedger: 100 });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "contract.emitted",
        contractId: "C1",
      })
    );

    subscriber.stop();
  });

  it("should advance cursor after first events response", async () => {
    let getEventsCallCount = 0;
    mockClient.request.mockImplementation((method: string, params: any) => {
      if (method === "getLatestLedger") return Promise.resolve({ result: { sequence: 100 } });
      if (method === "getEvents") {
        getEventsCallCount++;
        if (getEventsCallCount === 1) {
          return Promise.resolve({
            result: {
              latestLedger: 100,
              events: [
                {
                  id: "1",
                  pagingToken: "token1",
                  contractId: "C1",
                  type: "contract",
                  topic: ["t1"],
                  value: "v1",
                  ledger: 100,
                  ledgerClosedAt: "2023-01-01T00:00:00Z",
                  txHash: "0000000000000000000000000000000000000000000000000000000000000000",
                },
              ],
            },
          });
        }
        return Promise.resolve({ result: { latestLedger: 101, events: [] } });
      }
      });

    const subscriber = new SorobanSubscriber({
      rpcUrl: "http://localhost",
      pollIntervalMs: 2000,
      onEvent,
    });

    subscriber.start();
    await tick();

    await vi.advanceTimersByTimeAsync(2000);
    await tick();

    expect(mockClient.request).toHaveBeenNthCalledWith(3, "getEvents", {
      pagination: { cursor: "token1" },
    });

    subscriber.stop();
  });

  it("should stop polling within one interval", async () => {
    const subscriber = new SorobanSubscriber({
      rpcUrl: "http://localhost",
      pollIntervalMs: 2000,
      onEvent,
    });

    subscriber.start();
    await tick();

    subscriber.stop();
    expect(subscriber.isRunning).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    await tick();

    const getEventsCalls = mockClient.request.mock.calls.filter((c: any) => c[0] === "getEvents");
    expect(getEventsCalls).toHaveLength(1);
  });
});