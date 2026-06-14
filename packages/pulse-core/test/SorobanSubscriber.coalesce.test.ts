import { describe, it, expect, beforeEach } from "vitest";
import {
  SorobanSubscriber,
  type SorobanEvent,
  type SorobanRpcLike,
  type CursorStoreLike,
} from "../src/SorobanSubscriber.js";
import type { ContractSubscriptionFilter } from "../src/index.js";

class MemoryCursorStore implements CursorStoreLike {
  private cursor: string | undefined = undefined;
  async getCursor(): Promise<string | undefined> {
    return this.cursor;
  }
  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

class MockRpc implements SorobanRpcLike {
  public calls: {
    startCursor: string | undefined;
    limit: number;
    filters?: ContractSubscriptionFilter[];
  }[] = [];
  public responseMap = new Map<string, SorobanEvent[]>();
  public defaultResponse: SorobanEvent[] = [];

  async getEvents(
    startCursor: string | undefined,
    limit: number,
    signal?: AbortSignal,
    filters?: ContractSubscriptionFilter[],
  ): Promise<{ events: SorobanEvent[] }> {
    this.calls.push({ startCursor, limit, filters });

    if (filters && filters.length > 0) {
      const matchedEvents: SorobanEvent[] = [];
      for (const filter of filters) {
        const filterKey = JSON.stringify(filter);
        const eventsForFilter = this.responseMap.get(filterKey);
        if (eventsForFilter) {
          matchedEvents.push(...eventsForFilter);
        }
      }
      if (matchedEvents.length > 0) {
        return { events: matchedEvents };
      }
    }
    return { events: this.defaultResponse };
  }
}

function makeEvent(
  id: string,
  pagingToken: string,
  contractId?: string,
  topic: string[] = [],
): SorobanEvent {
  return { id, pagingToken, topic, value: "data", contractId, type: "contract.emitted" };
}

describe("SorobanSubscriber — coalescing and parallel filters", () => {
  let rpc: MockRpc;
  let cursorStore: MemoryCursorStore;

  beforeEach(() => {
    rpc = new MockRpc();
    cursorStore = new MemoryCursorStore();
  });

  it("coalesces up to 5 subscriptions into a single RPC call", async () => {
    const subscriber = new SorobanSubscriber({ rpc, cursorStore });

    subscriber.subscriptions = [
      { id: "sub1", filters: [{ contractIds: ["C1"] }] },
      { id: "sub2", filters: [{ contractIds: ["C2"] }] },
      { id: "sub3", filters: [{ contractIds: ["C3"] }] },
      { id: "sub4", filters: [{ contractIds: ["C4"] }] },
    ];

    await subscriber.pollOnce();

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].filters).toHaveLength(4);
    expect(rpc.calls[0].filters).toEqual([
      { contractIds: ["C1"] },
      { contractIds: ["C2"] },
      { contractIds: ["C3"] },
      { contractIds: ["C4"] },
    ]);
  });

  it("splits subscriptions into multiple parallel RPC calls when filters count > 5", async () => {
    const subscriber = new SorobanSubscriber({ rpc, cursorStore });

    subscriber.subscriptions = Array.from({ length: 7 }, (_, i) => ({
      id: `sub-${i}`,
      filters: [{ contractIds: [`C-${i}`] }],
    }));

    await subscriber.pollOnce();

    expect(rpc.calls).toHaveLength(2);
    expect(rpc.calls[0].filters).toHaveLength(5);
    expect(rpc.calls[1].filters).toHaveLength(2);
  });

  it("optimizes to a single match-all RPC call if any subscription has no filters", async () => {
    const subscriber = new SorobanSubscriber({ rpc, cursorStore });

    subscriber.subscriptions = [
      { id: "sub1", filters: [{ contractIds: ["C1"] }] },
      { id: "sub2", filters: [] },
      { id: "sub3", filters: [{ contractIds: ["C3"] }] },
    ];

    await subscriber.pollOnce();

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].filters).toBeUndefined();
  });

  it("routes returned events back to the originating subscriptions and sorts them chronologically", async () => {
    const subscriber = new SorobanSubscriber({ rpc, cursorStore });

    const sub1Events: SorobanEvent[] = [];
    const sub2Events: SorobanEvent[] = [];

    subscriber.subscriptions = [
      {
        id: "sub1",
        filters: [{ contractIds: ["C1"] }],
        onEvent: async (evt) => {
          sub1Events.push(evt);
        },
      },
      {
        id: "sub2",
        filters: [{ contractIds: ["C2"] }],
        onEvent: async (evt) => {
          sub2Events.push(evt);
        },
      },
    ];

    rpc.responseMap.set(JSON.stringify({ contractIds: ["C1"] }), [
      makeEvent("evt-B", "0000000002", "C1"),
    ]);
    rpc.responseMap.set(JSON.stringify({ contractIds: ["C2"] }), [
      makeEvent("evt-A", "0000000001", "C2"),
    ]);

    for (let i = 0; i < 6; i++) {
      subscriber.subscriptions.push({
        id: `dummy-${i}`,
        filters: [{ contractIds: [`CDUMMY-${i}`] }],
      });
    }

    await subscriber.pollOnce();

    expect(sub1Events).toHaveLength(1);
    expect(sub1Events[0].id).toBe("evt-B");

    expect(sub2Events).toHaveLength(1);
    expect(sub2Events[0].id).toBe("evt-A");

    expect(await cursorStore.getCursor()).toBe("0000000002");
  });

  it("maintains backward compatibility with constructor onEvent option", async () => {
    const emitted: SorobanEvent[] = [];
    const subscriber = new SorobanSubscriber({
      rpc,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
    });

    rpc.defaultResponse = [makeEvent("evt-1", "0000000001")];

    await subscriber.pollOnce();

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].filters).toBeUndefined();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe("evt-1");
  });
});
