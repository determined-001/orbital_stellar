import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SorobanRpcClient.pollUnifiedEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pages through multiple pages following the cursor", async () => {
    let callCount = 0;
    const fetch = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            events: [{ id: String(callCount), pagingToken: `000${callCount}` }],
            cursor: `000${callCount}`,
            latestLedger: 100,
          },
        });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          events: [],
          cursor: "0002",
          latestLedger: 100,
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch, timeoutMs: 5000 });
    const received: unknown[][] = [];
    const controller = new AbortController();

    const promise = client.pollUnifiedEvents((events) => received.push(events), {
      signal: controller.signal,
      pageLimit: 10,
    });

    // Poll 1 returns 1 event -> 1 < 10 -> sleep(2000)
    // Advance past first sleep
    await vi.advanceTimersByTimeAsync(2_001);
    // Poll 2 returns 1 event -> 1 < 10 -> sleep(2000)
    await vi.advanceTimersByTimeAsync(2_001);
    // Poll 3 returns 0 events -> 0 < 10 -> sleep(2000)
    // Abort during sleep
    controller.abort();

    const result = await promise;

    expect(received).toHaveLength(2);
    expect(received[0]).toHaveLength(1);
    expect((received[0] as Array<Record<string, unknown>>)[0].id).toBe("1");
    expect(received[1]).toHaveLength(1);
    expect((received[1] as Array<Record<string, unknown>>)[0].id).toBe("2");
    expect(result.cursor).toBe("0002");
  });

  it("backs off after 429 with Retry-After then resumes polling", async () => {
    let callCount = 0;
    const fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "rate limit" }), {
          status: 429,
          headers: { "content-type": "application/json", "Retry-After": "1" },
        });
      }
      if (callCount === 2) {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            events: [{ id: "1", pagingToken: "0001" }],
            cursor: "0001",
            latestLedger: 100,
          },
        });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          events: [],
          cursor: "0001",
          latestLedger: 100,
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch, timeoutMs: 5000 });
    const received: unknown[][] = [];
    const controller = new AbortController();

    const promise = client.pollUnifiedEvents((events) => received.push(events), {
      signal: controller.signal,
      pageLimit: 1,
      initialBackoffMs: 10_000,
      maxBackoffMs: 30_000,
    });

    // Call 1: 429 with Retry-After: 1 -> delayMs = 1000
    // Advance past the 1000ms retry-after sleep
    await vi.advanceTimersByTimeAsync(1_001);
    // Call 2: 1 event -> 1 < 1 (pageLimit) = false -> no sleep -> Call 3 immediately
    // Call 3: 0 events -> 0 < 1 = true -> sleep(2000)
    // Abort during sleep
    controller.abort();

    const result = await promise;

    expect(received).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.cursor).toBe("0001");
  });

  it("exits cleanly on abort during poll", async () => {
    const fetch = vi.fn(async () => {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          events: [{ id: "1", pagingToken: "0001" }],
          cursor: "0001",
          latestLedger: 100,
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch, timeoutMs: 5000 });
    const received: unknown[][] = [];
    const controller = new AbortController();

    const promise = client.pollUnifiedEvents((events) => received.push(events), {
      signal: controller.signal,
      pageLimit: 10,
    });

    // Poll 1 returns 1 event -> 1 < 10 -> sleep(2000)
    // Abort during the first sleep
    controller.abort();

    const result = await promise;

    expect(received).toHaveLength(1);
    expect(result.cursor).toBe("0001");
  });

  it("propagates terminal errors", async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch, timeoutMs: 5000 });
    const controller = new AbortController();

    await expect(
      client.pollUnifiedEvents(() => {}, { signal: controller.signal, maxRetries: 0 }),
    ).rejects.toThrow();
  });
});
