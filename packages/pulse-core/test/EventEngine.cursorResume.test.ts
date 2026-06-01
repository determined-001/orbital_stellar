import { beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

const streamInstances: Array<{ handlers: StreamHandlers; close: ReturnType<typeof vi.fn> }> = [];
const cursorArgs: string[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    constructor(url: string) {}

    operations() {
      return {
        cursor(start: string) {
          cursorArgs.push(start);
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ handlers, close });
              return close;
            },
          };
        },
      };
    }
  }

  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

import { EventEngine } from "../src/EventEngine.js";

function latestStream() {
  const s = streamInstances.at(-1);
  if (!s) throw new Error("no stream");
  return s;
}

describe("EventEngine cursor resume (horizon)", () => {
  beforeEach(() => {
    streamInstances.length = 0;
    cursorArgs.length = 0;
    vi.restoreAllMocks();
  });

  it("persists horizon cursor and resumes on restart", async () => {
    const storeMap = new Map<string, string>();
    const cursorStore = {
      get: vi.fn(async (k: string) => {
        return storeMap.get(k) ?? null;
      }),
      set: vi.fn(async (k: string, v: string) => {
        storeMap.set(k, v);
      }),
    };

    const engine1 = new EventEngine({ network: "testnet", cursorStore });
    const watcher = engine1.subscribe("GDEST");
    const handler = vi.fn();
    watcher.on("payment.received", handler);

    engine1.start();

    // First stream should start at "now"
    expect(cursorArgs[0]).toBe("now");

    // Deliver two messages with paging_token
    latestStream().handlers.onmessage({ type: "payment", to: "GDEST", from: "GSRC", amount: "1", asset_type: "native", created_at: "2026-01-01T00:00:00Z", paging_token: "100" });
    latestStream().handlers.onmessage({ type: "payment", to: "GDEST", from: "GSRC", amount: "2", asset_type: "native", created_at: "2026-01-01T00:00:01Z", paging_token: "101" });

    expect(handler).toHaveBeenCalledTimes(2);
    // cursorStore.set should have been called at least once with last cursor
    expect(cursorStore.set).toHaveBeenCalled();
    expect(storeMap.get("horizon:testnet")).toBe("101");

    engine1.stop();

    // Start a new engine with the same cursorStore and verify it requests the stored cursor
    const engine2 = new EventEngine({ network: "testnet", cursorStore });
    engine2.start();

    // The new stream should use the persisted cursor
    expect(cursorArgs[cursorArgs.length - 1]).toBe("101");
  });
});
