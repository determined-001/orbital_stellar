/**
 * EventEngine - CAP-67 unified transport lifecycle (issue 6.7).
 *
 * Covers:
 *  - `unified` reported in status() sources, on/off per `soroban.unifiedEvents`
 *  - start() begins polling; stop() cancels cleanly with no leaked timers
 *  - lifecycle notifications ("engine.reconnecting" / "engine.rate_limited" /
 *    "engine.reconnected") are emitted with `source: "unified"`
 *
 * Decoding/normalizing/dispatching the polled CAP-67 events to watchers is
 * out of scope here (separate issues) - these tests only exercise the
 * transport's start/stop/status/reconnect lifecycle.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";
import type { Watcher } from "../src/Watcher.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes a stubbed `globalThis.fetch` by JSON-RPC method, so the Soroban
 * `getNetwork()`/`getEvents()` calls each get a well-formed reply. `soroban`
 * config also spins up a `SorobanSubscriber` (unrelated to these tests, but
 * always created alongside the unified poller) whose own background
 * `getLatestLedger` polling hits the same mock - give it a harmless generic
 * JSON-RPC result rather than letting it 500/malformed-JSON into noisy
 * unhandled-rejection spam. Horizon's SSE stream also goes through
 * `globalThis.fetch` here; its non-JSON-RPC request gets an empty 200
 * instead - Horizon reconnecting in the background as a result is expected
 * and ignored, since these tests are only exercising the unified transport.
 */
function makeFetch(getEventsResult: () => unknown) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    let method: string | undefined;
    try {
      method = (JSON.parse(init.body as string) as { method?: string }).method;
    } catch {
      return new Response("", { status: 200 });
    }
    if (method === "getNetwork") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { passphrase: TESTNET_PASSPHRASE, protocolVersion: 22 },
      });
    }
    if (method === "getEvents") {
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: getEventsResult() });
    }
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { sequence: 100, events: [] } });
  }) as unknown as typeof fetch;
}

describe("EventEngine unified transport", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    SorobanRpcClient.setCachedNetwork(null);
    vi.useRealTimers();
  });

  it("reports unified as not running when soroban.unifiedEvents is not set", () => {
    const engine = new EventEngine({
      network: "testnet",
      soroban: { rpcUrl: "https://fake-rpc.example" },
    });

    expect(engine.status().sources.unified).toEqual({
      running: false,
      lastEventAt: null,
      reconnectAttempt: 0,
    });
  });

  it("reports unified as not running when soroban is not configured at all", () => {
    const engine = new EventEngine({ network: "testnet" });
    expect(engine.status().sources.unified).toEqual({
      running: false,
      lastEventAt: null,
      reconnectAttempt: 0,
    });
  });

  it("starts the poller on start() and reports it running in status()", async () => {
    vi.useFakeTimers();
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }));

    const engine = new EventEngine({
      network: "testnet",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.status().sources.unified.running).toBe(true);
    expect(engine.status().running).toBe(true);

    await engine.stop();
  });

  it("stops the poller cleanly on stop(), with no leaked polling activity", async () => {
    vi.useFakeTimers();
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    let callCount = 0;
    globalThis.fetch = makeFetch(() => {
      callCount++;
      return { events: [], cursor: `000${callCount}`, latestLedger: 100 };
    });

    const engine = new EventEngine({
      network: "testnet",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });

    engine.start();
    // Let a couple of poll/sleep cycles run (each empty page sleeps 2s).
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_001);
    await vi.advanceTimersByTimeAsync(2_001);

    const callsBeforeStop = callCount;
    expect(callsBeforeStop).toBeGreaterThan(0);

    await engine.stop();

    expect(engine.status().sources.unified.running).toBe(false);

    // Advancing time after stop() must not trigger any further polling -
    // the abort signal tore down the loop's pending `sleep()` timer instead
    // of leaving it to fire later and schedule another `getEvents` call.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callCount).toBe(callsBeforeStop);
  });

  it("tracks lastEventAt when the poller receives events", async () => {
    vi.useFakeTimers();
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
    let served = false;
    globalThis.fetch = makeFetch(() => {
      if (!served) {
        served = true;
        return {
          events: [{ id: "1", pagingToken: "0001", type: "contract" }],
          cursor: "0001",
          latestLedger: 100,
        };
      }
      return { events: [], cursor: "0001", latestLedger: 100 };
    });

    const engine = new EventEngine({
      network: "testnet",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.status().sources.unified.lastEventAt).not.toBeNull();

    await engine.stop();
  });

  it("emits engine.reconnecting / engine.reconnected with source: unified on transient failures", async () => {
    vi.useFakeTimers();
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });

    let getEventsCalls = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      let method: string | undefined;
      try {
        method = (JSON.parse(init.body as string) as { method?: string }).method;
      } catch {
        return new Response("", { status: 200 });
      }
      if (method === "getNetwork") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { passphrase: TESTNET_PASSPHRASE, protocolVersion: 22 },
        });
      }
      if (method !== "getEvents") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: { sequence: 100, events: [] } });
      }
      getEventsCalls++;
      if (getEventsCalls === 1) {
        // Simulate a transient 503 - SorobanRpcClient treats 5xx as retryable.
        return new Response("Service Unavailable", { status: 503 });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { events: [], cursor: "0001", latestLedger: 100 },
      });
    }) as unknown as typeof fetch;

    const engine = new EventEngine({
      network: "testnet",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });

    const watcher: Watcher = engine.subscribe("GABC");
    const reconnecting: unknown[] = [];
    const reconnected: unknown[] = [];
    watcher.on("engine.reconnecting", (n) => reconnecting.push(n));
    watcher.on("engine.reconnected", (n) => reconnected.push(n));

    engine.start();
    await vi.advanceTimersByTimeAsync(0); // first getEvents -> 503

    // Horizon's own SSE stream also reconnects in this test setup (its
    // request isn't valid JSON-RPC), so assert the unified notification is
    // present rather than that it's the only one.
    expect(reconnecting).toContainEqual(
      expect.objectContaining({ type: "engine.reconnecting", attempt: 1, source: "unified" }),
    );

    // Advance past the backoff sleep so the retry (which succeeds) runs.
    await vi.advanceTimersByTimeAsync(2_000);

    expect(reconnected).toContainEqual(
      expect.objectContaining({ type: "engine.reconnected", attempt: 1, source: "unified" }),
    );

    await engine.stop();
  });
});
