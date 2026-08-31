import { describe, expect, it, vi } from "vitest";
import { SorobanRpcError } from "../src/errors.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Serves one canned `result` per call, in order. */
function fetchSerially(results: unknown[]) {
  let index = 0;
  const calls: Array<{ method: string; params: unknown }> = [];

  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    calls.push({ method: body.method, params: body.params });
    const result = results[Math.min(index, results.length - 1)];
    index += 1;
    return jsonResponse({ jsonrpc: "2.0", id: 1, result });
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, calls };
}

describe("SorobanRpcClient submit path", () => {
  it("simulates a transaction and returns the raw result, error included", async () => {
    const { fetchImpl, calls } = fetchSerially([
      { id: "1", latestLedger: 9, error: "HostError: Error(Contract, #4)" },
    ]);
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    const simulation = await client.simulateTransaction("AAAA-tx-xdr");

    // A rejected invocation is a successful RPC call carrying an error - the
    // caller classifies it, the client does not throw.
    expect(simulation.error).toContain("Error(Contract, #4)");
    expect(calls[0]).toEqual({
      method: "simulateTransaction",
      params: { transaction: "AAAA-tx-xdr" },
    });
  });

  it("sends a transaction and reports the network's acceptance status", async () => {
    const { fetchImpl, calls } = fetchSerially([{ status: "PENDING", hash: "abc123" }]);
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    const sent = await client.sendTransaction("AAAA-signed-xdr");

    expect(sent).toEqual({ status: "PENDING", hash: "abc123" });
    expect(calls[0]).toEqual({
      method: "sendTransaction",
      params: { transaction: "AAAA-signed-xdr" },
    });
  });

  it("polls getTransaction until the transaction lands", async () => {
    const { fetchImpl, calls } = fetchSerially([
      { status: "NOT_FOUND" },
      { status: "NOT_FOUND" },
      { status: "SUCCESS", ledger: 77 },
    ]);
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    const result = await client.pollTransaction("abc123", { intervalMs: 1, timeoutMs: 1_000 });

    expect(result.status).toBe("SUCCESS");
    expect(result.ledger).toBe(77);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ method: "getTransaction", params: { hash: "abc123" } });
  });

  it("returns a FAILED status rather than treating it as an error", async () => {
    const { fetchImpl } = fetchSerially([{ status: "FAILED", resultXdr: "AAAA" }]);
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    const result = await client.pollTransaction("abc123", { intervalMs: 1 });

    expect(result.status).toBe("FAILED");
  });

  it("reports an unconfirmed transaction as retryable - it may still land", async () => {
    const { fetchImpl } = fetchSerially([{ status: "NOT_FOUND" }]);
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    try {
      await client.pollTransaction("abc123", { intervalMs: 5, timeoutMs: 10 });
      throw new Error("expected pollTransaction to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SorobanRpcError);
      const rpcError = error as SorobanRpcError;
      expect(rpcError.retryable).toBe(true);
      expect(rpcError.message).toContain("not confirmed");
    }
  });

  it("propagates a classified transport failure from the submit path", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "overloaded" } }),
    ) as unknown as typeof globalThis.fetch;
    const client = new SorobanRpcClient({ url: "https://rpc.example", fetch: fetchImpl });

    await expect(client.sendTransaction("AAAA")).rejects.toBeInstanceOf(SorobanRpcError);
  });
});
