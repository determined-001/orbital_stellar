import { expect, describe, it } from "vitest";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";
import { SorobanRpcError } from "../src/errors.js";

class MemoryCursorStore {
  cursor: string | undefined = "old-cursor";
  async getCursor() {
    return this.cursor;
  }
  async saveCursor(c: string) {
    this.cursor = c;
  }
}

describe("SorobanSubscriber — cursor expiration", () => {
  it("catches out-of-range cursor, emits engine.cursor_expired, and sets startLedger", async () => {
    let calls = 0;
    const rpc = {
      getEvents: async (startCursor: string | undefined) => {
        calls++;
        if (calls === 1 && startCursor === "old-cursor") {
          throw new SorobanRpcError("startCursor is before oldest ledger", {
            code: "invalid_request",
            retryable: false,
          });
        }
        return { events: [], latestLedger: 999999 };
      },
    };

    const cursorStore = new MemoryCursorStore();
    const subscriber = new SorobanSubscriber({
      rpc: rpc as any,
      cursorStore,
      setTimeoutFn: (cb: any) => {
        cb();
        return {} as any;
      },
      clearTimeoutFn: () => {},
    });

    const emitted: any[] = [];
    subscriber.on("engine.cursor_expired", (evt) => {
      emitted.push(evt);
    });

    // We suppress the warning for the test
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      await subscriber.pollOnce();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({ source: "soroban", lostCursor: "old-cursor" });
      expect(cursorStore.cursor).toBe("999999");
      expect(calls).toBe(2); // Initial poll + fallback poll for latestLedger
    } finally {
      console.warn = originalWarn;
    }
  });
});
