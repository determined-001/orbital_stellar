/**
 * Unified-stream (CAP-67) cursor format and persistence (issue 6.14).
 *
 * `CursorStore` treats every cursor as an opaque string with no source-specific
 * handling, so persisting a unified-stream cursor needs no interface change -
 * just a distinct key (`unified:${network}`, or `${streamKey}:unified` when
 * `streamKey` is set - see `EventEngine`'s constructor). These tests prove
 * that key/value round-trips through `MemoryCursorStore` and `FileCursorStore`
 * and that a restart resumes polling from exactly the last-persisted cursor
 * (no duplicates, no gaps) against a mocked RPC.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";
import { MemoryCursorStore } from "../src/MemoryCursorStore.js";
import { FileCursorStore } from "../src/FileCursorStore.js";
import type { CursorStoreLike } from "../src/CursorStore.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Real timers throughout this file, deliberately - not fake ones. The cursor
 * read on startup (`resolveUnifiedCursor`) goes through the real filesystem for
 * `FileCursorStore`, which fake timers don't advance, and a short real delay is
 * enough since each session here only needs to observe a single `getEvents`
 * call.
 *
 * The cursor WRITE is no longer a race: `EventEngine.stop()` flushes queued
 * cursor writes before resolving. This file used to sleep 20ms after `stop()`
 * and hope, which failed on slower machines and under parallel test load.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Same routing technique as EventEngine.unifiedTransport.test.ts (issue 6.7). */
function makeFetch(
  getEvents: (cursor: string | undefined) => { events: unknown[]; cursor: string },
) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    let parsed: { method?: string; params?: { cursor?: string } } | undefined;
    try {
      parsed = JSON.parse(init.body as string);
    } catch {
      return new Response("", { status: 200 });
    }
    if (parsed?.method === "getNetwork") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { passphrase: TESTNET_PASSPHRASE, protocolVersion: 22 },
      });
    }
    if (parsed?.method === "getEvents") {
      const result = getEvents(parsed.params?.cursor);
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: { ...result, latestLedger: 100 } });
    }
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { sequence: 100, events: [] } });
  }) as unknown as typeof fetch;
}

async function runOnePollCycle(
  cursorStore: CursorStoreLike,
  fetchResult: (cursor: string | undefined) => { events: unknown[]; cursor: string },
) {
  globalThis.fetch = makeFetch(fetchResult);
  const engine = new EventEngine({
    network: "testnet",
    soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    cursorStore,
  });
  engine.start();
  await delay(50);
  // `stop()` awaits the poller and then flushes pending cursor writes, so the
  // store is guaranteed settled once this resolves - no trailing sleep.
  await engine.stop();
}

describe("unified-stream cursor persistence", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    SorobanRpcClient.setCachedNetwork(null);
    vi.useRealTimers();
  });

  it("persists the unified cursor under unified:${network} in MemoryCursorStore", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    const store = new MemoryCursorStore();

    await runOnePollCycle(store, () => ({
      events: [{ id: "1", pagingToken: "0001", type: "contract" }],
      cursor: "0015933813272113152-0000000000",
    }));

    expect(await store.get("unified:testnet")).toBe("0015933813272113152-0000000000");
    // Horizon's own default-keyed cursor is stored independently, under a
    // different key - no interface change, just a distinct source key.
    expect(await store.get("horizon:testnet")).not.toBe("0015933813272113152-0000000000");
  });

  it("resumes from the persisted cursor after a restart, with no duplicates and no gaps (MemoryCursorStore)", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    const store = new MemoryCursorStore();

    // First session: one page, cursor advances to "0001".
    await runOnePollCycle(store, () => ({
      events: [{ id: "1", pagingToken: "0001", type: "contract" }],
      cursor: "0001",
    }));
    expect(await store.get("unified:testnet")).toBe("0001");

    // Second session ("restart"): assert the very first getEvents call after
    // resume carries the previously-persisted cursor, proving no gap (it
    // doesn't restart from the beginning) and no duplicate (it doesn't
    // replay event "1" again by omitting the cursor).
    let cursorOnFirstResumedCall: string | undefined;
    let calls = 0;
    await runOnePollCycle(store, (cursor) => {
      calls++;
      if (calls === 1) cursorOnFirstResumedCall = cursor;
      return { events: [], cursor: cursor ?? "0001" };
    });

    expect(cursorOnFirstResumedCall).toBe("0001");
  });

  it("resumes from the persisted cursor after a restart (FileCursorStore)", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-cursor-"));
    const store = new FileCursorStore(dir);

    await runOnePollCycle(store, () => ({
      events: [{ id: "1", pagingToken: "0007", type: "contract" }],
      cursor: "0007",
    }));
    expect(await store.get("unified:testnet")).toBe("0007");

    let cursorOnFirstResumedCall: string | undefined;
    await runOnePollCycle(store, (cursor) => {
      if (cursorOnFirstResumedCall === undefined) cursorOnFirstResumedCall = cursor;
      return { events: [], cursor: cursor ?? "0007" };
    });

    expect(cursorOnFirstResumedCall).toBe("0007");

    await fs.rm(dir, { recursive: true, force: true });
  });
});
