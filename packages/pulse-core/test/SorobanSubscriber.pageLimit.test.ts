/**
 * SorobanSubscriber – pagination limit tests
 *
 * Covers:
 *  - default pageLimit is 100
 *  - custom pageLimit within valid range (1–10,000)
 *  - out-of-range pageLimit throws RangeError at construction
 *  - configured pageLimit is passed to every getEvents call
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SorobanSubscriber,
  type SorobanEvent,
  type SorobanRpcLike,
  type CursorStoreLike,
} from "../src/SorobanSubscriber.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Builds a minimal SorobanEvent. */
function makeEvent(id: string, pagingToken?: string): SorobanEvent {
  return { id, pagingToken: pagingToken ?? id, topic: [], value: "" };
}

/** In-memory cursor store used across tests. */
class MemoryCursorStore implements CursorStoreLike {
  private cursor: string | undefined = undefined;
  async getCursor(): Promise<string | undefined> {
    return this.cursor;
  }
  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

/** RPC stub that records the limit passed to getEvents. */
class StubRpc implements SorobanRpcLike {
  page: SorobanEvent[] = [];
  recordedLimits: number[] = [];

  async getEvents(
    _startCursor: string | undefined,
    limit: number,
  ): Promise<{ events: SorobanEvent[] }> {
    this.recordedLimits.push(limit);
    return { events: this.page };
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SorobanSubscriber – pagination limit", () => {
  let stub: StubRpc;
  let cursorStore: MemoryCursorStore;
  let emitted: SorobanEvent[];

  beforeEach(() => {
    stub = new StubRpc();
    cursorStore = new MemoryCursorStore();
    emitted = [];
  });

  // ── 1. Default pageLimit is 100 ────────────────────────────────────────

  it("defaults to pageLimit of 100", async () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
    });

    stub.page = [makeEvent("evt-1")];
    await sub.pollOnce();

    expect(stub.recordedLimits).toEqual([100]);
  });

  // ── 2. Custom pageLimit is used ─────────────────────────────────────────

  it("uses configured pageLimit when provided", async () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
      pageLimit: 5000,
    });

    stub.page = [makeEvent("evt-1")];
    await sub.pollOnce();

    expect(stub.recordedLimits).toEqual([5000]);
  });

  // ── 3. pageLimit is used in every poll ──────────────────────────────────

  it("sends the same pageLimit on every poll", async () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
      pageLimit: 2500,
    });

    stub.page = [makeEvent("evt-1", "tok-1")];
    await sub.pollOnce();

    stub.page = [makeEvent("evt-2", "tok-2")];
    await sub.pollOnce();

    stub.page = [makeEvent("evt-3", "tok-3")];
    await sub.pollOnce();

    expect(stub.recordedLimits).toEqual([2500, 2500, 2500]);
  });

  // ── 4. Lower bound: pageLimit = 1 is valid ────────────────────────────

  it("accepts pageLimit = 1 (lower bound)", () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async () => {},
      pageLimit: 1,
    });

    expect(sub).toBeDefined();
  });

  // ── 5. Upper bound: pageLimit = 10000 is valid ────────────────────────

  it("accepts pageLimit = 10000 (upper bound)", () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async () => {},
      pageLimit: 10000,
    });

    expect(sub).toBeDefined();
  });

  // ── 6. Out of range: pageLimit = 0 throws ──────────────────────────────

  it("throws RangeError when pageLimit < 1", () => {
    expect(() => {
      new SorobanSubscriber({
        rpc: stub,
        cursorStore,
        onEvent: async () => {},
        pageLimit: 0,
      });
    }).toThrow(RangeError);

    expect(() => {
      new SorobanSubscriber({
        rpc: stub,
        cursorStore,
        onEvent: async () => {},
        pageLimit: -1,
      });
    }).toThrow(RangeError);
  });

  // ── 7. Out of range: pageLimit = 10001 throws ──────────────────────────

  it("throws RangeError when pageLimit > 10000", () => {
    expect(() => {
      new SorobanSubscriber({
        rpc: stub,
        cursorStore,
        onEvent: async () => {},
        pageLimit: 10001,
      });
    }).toThrow(RangeError);

    expect(() => {
      new SorobanSubscriber({
        rpc: stub,
        cursorStore,
        onEvent: async () => {},
        pageLimit: 100000,
      });
    }).toThrow(RangeError);
  });

  // ── 8. RangeError message is clear ──────────────────────────────────────

  it("provides a clear error message for out-of-range values", () => {
    expect(() => {
      new SorobanSubscriber({
        rpc: stub,
        cursorStore,
        onEvent: async () => {},
        pageLimit: 50000,
      });
    }).toThrow(/pageLimit must be between 1 and 10,000/);
  });

  // ── 9. pageLimit works with multiple events ─────────────────────────────

  it("applies pageLimit consistently when receiving multiple events", async () => {
    const sub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
      pageLimit: 7500,
    });

    stub.page = [
      makeEvent("evt-1", "tok-1"),
      makeEvent("evt-2", "tok-2"),
      makeEvent("evt-3", "tok-3"),
    ];
    await sub.pollOnce();

    expect(stub.recordedLimits).toEqual([7500]);
    expect(emitted).toHaveLength(3);
  });
});
