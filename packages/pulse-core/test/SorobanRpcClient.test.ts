import { describe, expect, it, vi } from "vitest";
import { SorobanRpcError } from "../src/errors.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectSorobanRpcError(
  action: () => Promise<unknown>,
  expected: { code: SorobanRpcError["code"]; retryable: boolean; status?: number }
): Promise<void> {
  try {
    await action();
    throw new Error("Expected action to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(SorobanRpcError);
    const rpcError = error as SorobanRpcError;
    expect(rpcError.code).toBe(expected.code);
    expect(rpcError.retryable).toBe(expected.retryable);
    expect(rpcError.status).toBe(expected.status);
  }
}

describe("SorobanRpcClient", () => {
  it("returns typed getEvents responses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: "pulse-core-getEvents",
        result: {
          events: [{ pagingToken: "000001", topic: ["transfer"] }],
          latestLedger: 123,
          cursor: "000001",
        },
      })
    ) as unknown as typeof fetch;

    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });
    const result = await client.getEvents("000000", 10);

    expect(result).toEqual({
      events: [{ pagingToken: "000001", topic: ["transfer"] }],
      latestLedger: 123,
      cursor: "000001",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"method":"getEvents"'),
      })
    );
  });

  it.each([
    [429, "rate_limit", true],
    [401, "auth", false],
    [403, "auth", false],
    [400, "invalid_request", false],
    [404, "invalid_request", false],
    [500, "server", true],
    [503, "server", true],
  ] as const)("maps HTTP %s to %s retryable=%s", async (status, code, retryable) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, status)) as unknown as typeof fetch;
    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });

    await expectSorobanRpcError(() => client.getEvents(), {
      code,
      retryable,
      status,
    });
  });

  it("maps fetch failures to retryable network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });

    await expectSorobanRpcError(() => client.getEvents(), {
      code: "network",
      retryable: true,
    });
  });

  it("maps malformed JSON to terminal invalid_request", async () => {
    const fetchImpl = vi.fn(async () => new Response("{", { status: 200 })) as unknown as typeof fetch;
    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });

    await expectSorobanRpcError(() => client.getEvents(), {
      code: "invalid_request",
      retryable: false,
    });
  });

  it("maps JSON-RPC server errors to retryable server errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: "pulse-core-getEvents",
        error: { code: -32001, message: "temporary upstream failure" },
      })
    ) as unknown as typeof fetch;
    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });

    await expectSorobanRpcError(() => client.getEvents(), {
      code: "server",
      retryable: true,
    });
  });

  it("maps JSON-RPC request errors to terminal invalid_request errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: "pulse-core-getEvents",
        error: { code: -32602, message: "invalid params" },
      })
    ) as unknown as typeof fetch;
    const client = new SorobanRpcClient({ rpcUrl: "https://rpc.example", fetchImpl });

    await expectSorobanRpcError(() => client.getEvents(), {
      code: "invalid_request",
      retryable: false,
    });
  });
});
