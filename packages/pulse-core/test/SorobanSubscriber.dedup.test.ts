/**
 * SorobanSubscriber – deduplication tests
 *
 * Covers:
 *  - duplicate event ID emitted only once
 *  - replaying the same page twice emits once
 *  - distinct event IDs emit normally
 *  - LRU eviction behaviour
 *  - capacity boundary behaviour
 *  - dedup cache updates correctly
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

/** RPC stub whose page is set per-test. */
class StubRpc implements SorobanRpcLike {
  page: SorobanEvent[] = [];
  async getEvents(): Promise<{ events: SorobanEvent[] }> {
    return { events: this.page };
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SorobanSubscriber – deduplication", () => {
  let stub: StubRpc;
  let cursorStore: MemoryCursorStore;
  let emitted: SorobanEvent[];

  const makeSubscriber = (dedupCacheSize?: number) =>
    new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async (evt) => {
        emitted.push(evt);
      },
      dedupCacheSize,
    });

  beforeEach(() => {
    stub = new StubRpc();
    cursorStore = new MemoryCursorStore();
    emitted = [];
  });

  // ── 1. Duplicate event ID is emitted only once ──────────────────────────

  it("emits a duplicate event ID only once across two polls", async () => {
    stub.page = [makeEvent("evt-A")];

    const sub = makeSubscriber();
    await sub.pollOnce();
    await sub.pollOnce(); // same page returned again

    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe("evt-A");
  });

  // ── 2. Replaying the same page twice emits once per event ───────────────

  it("replaying the same page twice emits each unique event exactly once", async () => {
    stub.page = [
      makeEvent("evt-1", "tok-1"),
      makeEvent("evt-2", "tok-2"),
      makeEvent("evt-3", "tok-3"),
    ];

    const sub = makeSubscriber();
    await sub.pollOnce(); // emits all 3
    await sub.pollOnce(); // all 3 are now duplicates → suppressed

    expect(emitted).toHaveLength(3);
    expect(emitted.map((e) => e.id)).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  // ── 3. Distinct event IDs still emit normally ───────────────────────────

  it("emits all events when every ID is unique", async () => {
    const sub = makeSubscriber();

    stub.page = [makeEvent("a"), makeEvent("b")];
    await sub.pollOnce();

    stub.page = [makeEvent("c"), makeEvent("d")];
    await sub.pollOnce();

    expect(emitted.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  // ── 4. LRU eviction behaviour ───────────────────────────────────────────

  it("evicts the oldest entry when capacity is exceeded (cap=2)", async () => {
    // Cap of 2: after "a" and "b" are added, adding "c" evicts "a".
    // Seeing "a" again should then emit it (no longer in the window).
    const sub = makeSubscriber(2);

    stub.page = [makeEvent("a"), makeEvent("b")];
    await sub.pollOnce(); // seen: {a, b}

    stub.page = [makeEvent("c")];
    await sub.pollOnce(); // seen: {b, c}  (a evicted)

    stub.page = [makeEvent("a")]; // "a" is gone from the window → emitted again
    await sub.pollOnce();

    expect(emitted.map((e) => e.id)).toEqual(["a", "b", "c", "a"]);
  });

  // ── 5. Capacity boundary behaviour ─────────────────────────────────────

  it("handles exactly cap events without evicting any", async () => {
    const cap = 4;
    const sub = makeSubscriber(cap);

    const events = Array.from({ length: cap }, (_, i) => makeEvent(`id-${i}`));
    stub.page = events;
    await sub.pollOnce(); // fills cache exactly to cap

    // Replay – all should be suppressed (nothing evicted).
    await sub.pollOnce();

    expect(emitted).toHaveLength(cap); // only first pass emitted
  });

  it("evicts oldest when one over cap is added", async () => {
    const cap = 3;
    const sub = makeSubscriber(cap);

    // Fill to cap: ids 0,1,2
    stub.page = Array.from({ length: cap }, (_, i) => makeEvent(`id-${i}`));
    await sub.pollOnce(); // seen: {0,1,2}

    // Add one more → id-0 is evicted
    stub.page = [makeEvent("id-3")];
    await sub.pollOnce(); // seen: {1,2,3}

    // id-0 should be re-emittable now
    stub.page = [makeEvent("id-0")];
    await sub.pollOnce();

    // Emitted: id-0,id-1,id-2 (first pass) + id-3 + id-0 again
    expect(emitted.map((e) => e.id)).toEqual([
      "id-0",
      "id-1",
      "id-2",
      "id-3",
      "id-0",
    ]);
  });

  // ── 6. Dedup cache updates correctly ───────────────────────────────────

  it("updates the cache only after successful onEvent delivery", async () => {
    // Event "x" is in the page; after first poll it must be in the cache so
    // a second poll suppresses it.
    const sub = makeSubscriber();

    stub.page = [makeEvent("x")];
    await sub.pollOnce();

    // Second poll with same page
    const before = emitted.length;
    await sub.pollOnce();

    expect(emitted.length).toBe(before); // nothing new
  });

  it("does not record an event ID if onEvent throws", async () => {
    let callCount = 0;
    const throwingSub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async () => {
        callCount++;
        throw new Error("handler error");
      },
    });

    stub.page = [makeEvent("fail-id")];

    // First poll – onEvent throws, so "fail-id" must NOT be recorded.
    await expect(throwingSub.pollOnce()).rejects.toThrow("handler error");

    // Reset to non-throwing; the event should emit again (not suppressed).
    let secondCallCount = 0;
    const recoverySub = new SorobanSubscriber({
      rpc: stub,
      cursorStore,
      onEvent: async () => {
        secondCallCount++;
      },
    });

    await recoverySub.pollOnce();
    expect(secondCallCount).toBe(1);
  });

  // ── 7. Acceptance criteria ──────────────────────────────────────────────

  it("replaying a full page twice produces downstream events exactly once per unique ID", async () => {
    const page = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`evt-${i}`, `tok-${i}`)
    );
    stub.page = page;

    const sub = makeSubscriber();
    await sub.pollOnce();
    await sub.pollOnce(); // full replay

    expect(emitted).toHaveLength(10);
    expect(emitted.map((e) => e.id)).toEqual(page.map((e) => e.id));
  });
});
