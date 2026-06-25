import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CursorStore } from "../src/CursorStore.js";
import { EventEngine } from "../src/EventEngine.js";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  cursor: string;
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    operations() {
      return {
        cursor(cursor: string) {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ cursor, handlers, close });
              return close;
            },
          };
        },
      };
    }
  }

  return { Horizon: { Server: MockServer } };
});

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) throw new Error("Expected an active mock stream.");
  return stream;
}

function makePaymentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "payment",
    paging_token: "1",
    created_at: new Date().toISOString(),
    transaction_successful: true,
    id: "1",
    source_account: "GSRC",
    from: "GSRC",
    to: "GDEST",
    amount: "10.0000000",
    asset_type: "native",
    ...overrides,
  };
}

class MemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, string>();

  async get(streamKey: string): Promise<string | null> {
    return this.cursors.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.cursors.set(streamKey, cursor);
  }

  async getAll(): Promise<Array<{ streamKey: string; cursor: string }>> {
    return Array.from(this.cursors.entries()).map(([streamKey, cursor]) => ({ streamKey, cursor }));
  }
}

class FakeSorobanRpc {
  public startCursors: Array<string | undefined> = [];
  public events: Array<{ id: string; pagingToken: string; topic: string[]; value: unknown }> = [];

  async getEvents(startCursor: string | undefined, limit: number): Promise<{ events: typeof this.events }> {
    void limit;
    this.startCursors.push(startCursor);
    return { events: this.events };
  }
}

describe("EventEngine cursor resume", () => {
  beforeEach(() => {
    streamInstances.length = 0;
    vi.restoreAllMocks();
  });

  it("resumes the Horizon stream from the last stored cursor", async () => {
    const cursorStore = new MemoryCursorStore();

    const engine1 = new EventEngine({ network: "testnet", cursorStore });
    const watcher1 = engine1.subscribe("GDEST");
    const received1: unknown[] = [];
    watcher1.on("payment.sent", (evt) => received1.push(evt));

    engine1.start();

    expect(latestStream().cursor).toBe("now");

    latestStream().handlers.onmessage(makePaymentRecord({ paging_token: "10" }));
    expect(received1).toHaveLength(1);
    expect(await cursorStore.get("horizon:testnet")).toBe("10");

    engine1.stop();

    const engine2 = new EventEngine({ network: "testnet", cursorStore });
    const watcher2 = engine2.subscribe("GDEST");
    const received2: unknown[] = [];
    watcher2.on("payment.sent", (evt) => received2.push(evt));

    engine2.start();
    expect(latestStream().cursor).toBe("horizon:testnet");

    latestStream().handlers.onmessage(makePaymentRecord({ paging_token: "11" }));
    expect(received2).toHaveLength(1);
    expect(await cursorStore.get("horizon:testnet")).toBe("11");
  });

  it("continues Soroban stream from the stored cursor key", async () => {
    const cursorStore = new MemoryCursorStore();
    const fakeRpc1 = new FakeSorobanRpc();
    fakeRpc1.events = [
      { id: "evt-1", pagingToken: "100", topic: [], value: "first" },
    ];

    const subscriber1 = new SorobanSubscriber({
      rpc: fakeRpc1,
      cursorStore,
      streamKey: "soroban:testnet",
      onEvent: async () => {},
      pageLimit: 10,
    });

    await subscriber1.pollOnce();
    expect(fakeRpc1.startCursors).toEqual([undefined]);
    expect(await cursorStore.get("soroban:testnet")).toBe("100");

    const fakeRpc2 = new FakeSorobanRpc();
    fakeRpc2.events = [
      { id: "evt-2", pagingToken: "200", topic: [], value: "second" },
    ];

    const subscriber2 = new SorobanSubscriber({
      rpc: fakeRpc2,
      cursorStore,
      streamKey: "soroban:testnet",
      onEvent: async () => {},
      pageLimit: 10,
    });

    await subscriber2.pollOnce();
    expect(fakeRpc2.startCursors).toEqual(["100"]);
    expect(await cursorStore.get("soroban:testnet")).toBe("200");
  });

  it("delivers Horizon events even when cursor persistence fails", async () => {
    const warnCalls: Array<{ message: string }> = [];

    const cursorStore: CursorStore = {
      async get() {
        return null;
      },
      async set(streamKey: string, cursor: string) {
        throw new Error("cursor persist failed");
      },
      async getAll() {
        return [];
      },
    };

    const logger = {
      info: () => {},
      warn: (message: string) => {
        warnCalls.push({ message });
      },
      error: () => {},
    };

    const engine = new EventEngine({ network: "testnet", cursorStore, logger });
    const watcher = engine.subscribe("GDEST");
    const received: unknown[] = [];
    watcher.on("payment.sent", (evt) => received.push(evt));

    engine.start();

    latestStream().handlers.onmessage(makePaymentRecord({ paging_token: "50" }));
    expect(received).toHaveLength(1);
    expect(warnCalls.some((c) => c.message.includes("cursorStore.set"))).toBe(true);
  });
});

