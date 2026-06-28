import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { dedupReceiver, MemoryDedupStore } from "../src/index.js";
import type { DedupStore } from "../src/index.js";

function makeEvent(id: string) {
  return {
    type: "payment.received" as const,
    to: "GDEST",
    from: "GSRC",
    amount: "10",
    asset: "XLM",
    timestamp: "2026-04-26T12:00:00.000Z",
    raw: { id },
  };
}

describe("MemoryDedupStore", () => {
  it("returns false for unseen id", async () => {
    const store = new MemoryDedupStore();
    expect(await store.seen("evt_1")).toBe(false);
  });

  it("returns true after mark", async () => {
    const store = new MemoryDedupStore();
    await store.mark("evt_1");
    expect(await store.seen("evt_1")).toBe(true);
  });

  it("tracks multiple ids independently", async () => {
    const store = new MemoryDedupStore();
    await store.mark("evt_1");
    expect(await store.seen("evt_1")).toBe(true);
    expect(await store.seen("evt_2")).toBe(false);
  });

  it("clear resets state", async () => {
    const store = new MemoryDedupStore();
    await store.mark("evt_1");
    store.clear();
    expect(await store.seen("evt_1")).toBe(false);
  });
});

describe("dedupReceiver", () => {
  it("invokes handler for unseen id", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDedupStore();
    const wrapped = dedupReceiver(handler, store);

    await wrapped(makeEvent("evt_1"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips handler for already-seen id", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDedupStore();
    const wrapped = dedupReceiver(handler, store);

    await wrapped(makeEvent("evt_1"));
    await wrapped(makeEvent("evt_1"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("invokes handler for different ids", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDedupStore();
    const wrapped = dedupReceiver(handler, store);

    await wrapped(makeEvent("evt_1"));
    await wrapped(makeEvent("evt_2"));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("uses custom idExtractor when provided", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDedupStore();
    const extractor = (event: { txHash: string }) => event.txHash;
    const wrapped = dedupReceiver(handler as any, store, { idExtractor: extractor as any });

    await wrapped({ txHash: "hash1" } as any);
    await wrapped({ txHash: "hash1" } as any);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws when event has no raw.id and no custom extractor", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDedupStore();
    const wrapped = dedupReceiver(handler, store);

    const badEvent = { type: "payment.received", raw: {} };

    await expect(wrapped(badEvent as any)).rejects.toThrow("dedupReceiver");
    expect(handler).not.toHaveBeenCalled();
  });

  it("marks before invoking handler (at-most-once even if handler throws)", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler error"));
    const store = new MemoryDedupStore();
    const wrapped = dedupReceiver(handler, store);

    const event = makeEvent("evt_1");

    await expect(wrapped(event)).rejects.toThrow("handler error");
    expect(handler).toHaveBeenCalledTimes(1);

    // Second call should be skipped — already marked
    await wrapped(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("works with a custom store implementation", async () => {
    const marks = new Set<string>();
    const customStore: DedupStore = {
      seen: async (id) => marks.has(id),
      mark: async (id) => {
        marks.add(id);
      },
    };

    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = dedupReceiver(handler, customStore);

    await wrapped(makeEvent("evt_1"));
    await wrapped(makeEvent("evt_1"));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
