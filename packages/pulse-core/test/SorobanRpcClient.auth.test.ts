import { afterEach, describe, expect, it, vi } from "vitest";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

describe("SorobanRpcClient — authenticated RPC providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("accepts a URL with no headers", () => {
      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });
      expect(client).toBeInstanceOf(SorobanRpcClient);
    });

    it("accepts a URL with custom headers", () => {
      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
        headers: { Authorization: "Bearer test-token-123" },
      });
      expect(client).toBeInstanceOf(SorobanRpcClient);
    });
  });

  describe("request() — header forwarding", () => {
    it("forwards configured headers on every request", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
        headers: {
          Authorization: "Bearer secret-api-key",
          "X-Custom-Header": "custom-value",
        },
      });

      await client.request("ping");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe("https://soroban-rpc.example.com");
      expect(callOptions.method).toBe("POST");
      expect(callOptions.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer secret-api-key",
        "X-Custom-Header": "custom-value",
      });
    });

    it("sends headers even when no custom headers are configured", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });

      await client.request("ping");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(callOptions.headers).toEqual({
        "Content-Type": "application/json",
      });
    });

    it("sends JSON-RPC 2.0 payload", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });

      await client.request("getHealth");

      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: undefined,
      });
    });
  });

  describe("request() — error handling", () => {
    it("throws when the server responds with a non-OK status", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
        headers: { Authorization: "Bearer invalid-token" },
      });

      await expect(client.request("getHealth")).rejects.toThrow(
        "Soroban RPC request failed: 401 Unauthorized",
      );
    });
  });

  describe("log redaction of header values", () => {
    it("does not log raw header values", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
        headers: {
          Authorization: "Bearer super-secret-token-abc-123",
        },
        logger,
      });

      await client.request("ping");

      expect(logger.debug).toHaveBeenCalledWith("[SorobanRpcClient] sending request", {
        method: "ping",
        headers: { Authorization: "[REDACTED]" },
      });
      // The raw secret must never appear in any logged metadata.
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("super-secret-token-abc-123");
    });

    it("redacts all header values regardless of header name", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
        headers: {
          "X-Api-Key": "my-api-key",
          "X-Secret": "my-secret-value",
        },
        logger,
      });

      await client.request("ping");

      expect(logger.debug).toHaveBeenCalledWith("[SorobanRpcClient] sending request", {
        method: "ping",
        headers: { "X-Api-Key": "[REDACTED]", "X-Secret": "[REDACTED]" },
      });
    });
  });

  describe("getEvents()", () => {
    it("returns events from the RPC response", async () => {
      const mockEvents = [
        { id: "event-1", value: "hello" },
        { id: "event-2", value: "world" },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { events: mockEvents },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });

      const { events } = await client.getEvents();

      expect(events).toEqual(mockEvents);
    });

    it("passes startCursor and limit as parameters", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { events: [] },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });

      await client.getEvents("000001", 50);

      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params).toEqual({
        startCursor: "000001",
        limit: 50,
        xdrFormat: "json",
      });
    });

    it("returns empty events array when result is missing", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new SorobanRpcClient({
        url: "https://soroban-rpc.example.com",
      });

      const { events } = await client.getEvents();

      expect(events).toEqual([]);
    });
  });
});
