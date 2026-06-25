import { afterEach, describe, expect, it, vi } from "vitest";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";
import { SorobanSubscriber } from "../src/SorobanSubscriber.js";
import { normalizeContractEvent } from "../src/EventEngine.js";

describe("SorobanRpcClient xdrFormat options & Normalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SorobanRpcClient getEvents() options", () => {
    it("defaults xdrFormat to 'json' in request params", async () => {
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

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params).toEqual({
        startCursor: "000001",
        limit: 50,
        xdrFormat: "json",
      });
    });

    it("allows overriding xdrFormat to 'base64'", async () => {
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

      await client.getEvents("000001", 50, { xdrFormat: "base64" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params).toEqual({
        startCursor: "000001",
        limit: 50,
        xdrFormat: "base64",
      });
    });

    it("accepts AbortSignal directly as the third argument for backward compatibility", async () => {
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

      const controller = new AbortController();
      await client.getEvents("000001", 50, controller.signal);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(callOptions.signal).toBe(controller.signal);
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params.xdrFormat).toBe("json");
    });
  });

  describe("normalizeContractEvent xdrFormat branching", () => {
    const mockRawEvent = {
      type: "contract",
      ledger: 100,
      ledgerClosedAt: "2026-06-01T00:00:00Z",
      contractId: "C123456",
      id: "event-001",
      pagingToken: "token-001",
      topic: ["transfer"],
      value: "AAAAEAAAAA5VbW91bnQAAAAAAA==",
      inSuccessfulContractCall: true,
      txHash: "hash-001",
    };

    it("preserves raw base64 value and leaves decodedData undefined when xdrFormat is base64", () => {
      const result = normalizeContractEvent(mockRawEvent, "base64");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("contract_emitted");

      const emitted = result as any;
      expect(emitted.value).toBe("AAAAEAAAAA5VbW91bnQAAAAAAA==");
      expect(emitted.decodedData).toBeUndefined();
    });

    it("populates decodedData and clears/empties value when xdrFormat is json", () => {
      const mockJsonValRawEvent = {
        ...mockRawEvent,
        value: { amount: 1000 },
      };
      const result = normalizeContractEvent(mockJsonValRawEvent, "json");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("contract_emitted");

      const emitted = result as any;
      expect(emitted.value).toBe("");
      expect(emitted.decodedData).toEqual({ amount: 1000 });
    });

    it("auto-detects json if value is an object even if format is default/base64", () => {
      const mockJsonValRawEvent = {
        ...mockRawEvent,
        value: { amount: 1000 },
      };
      const result = normalizeContractEvent(mockJsonValRawEvent);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("contract_emitted");

      const emitted = result as any;
      expect(emitted.value).toBe("");
      expect(emitted.decodedData).toEqual({ amount: 1000 });
    });
  });

  describe("SorobanSubscriber integration with xdrFormat option", () => {
    it("configures client request and populates decodedData on emitted events", async () => {
      const mockEvents = [
        {
          id: "event-1",
          pagingToken: "token-1",
          topic: ["transfer"],
          value: { amount: 2000 },
        },
      ];

      const rpcMock = {
        getEvents: vi.fn().mockResolvedValue({ events: mockEvents }),
      };

      const cursorStoreMock = {
        getCursor: vi.fn().mockResolvedValue(undefined),
        saveCursor: vi.fn().mockResolvedValue(undefined),
      };

      const eventsReceived: any[] = [];
      const onEvent = async (event: any) => {
        eventsReceived.push(event);
      };

      const subscriber = new SorobanSubscriber({
        rpc: rpcMock,
        cursorStore: cursorStoreMock,
        onEvent,
        xdrFormat: "json",
      });

      await subscriber.pollOnce();

      expect(rpcMock.getEvents).toHaveBeenCalledWith(
        undefined,
        100,
        expect.any(AbortSignal),
        undefined,
        expect.objectContaining({ xdrFormat: "json" }),
      );

      expect(eventsReceived).toHaveLength(1);
      expect(eventsReceived[0].decodedData).toEqual({ amount: 2000 });
    });

    it("preserves raw base64 envelopes when xdrFormat is base64", async () => {
      const mockEvents = [
        {
          id: "event-1",
          pagingToken: "token-1",
          topic: ["transfer"],
          value: "AAAAEAAAAA5VbW91bnQAAAAAAA==",
        },
      ];

      const rpcMock = {
        getEvents: vi.fn().mockResolvedValue({ events: mockEvents }),
      };

      const cursorStoreMock = {
        getCursor: vi.fn().mockResolvedValue(undefined),
        saveCursor: vi.fn().mockResolvedValue(undefined),
      };

      const eventsReceived: any[] = [];
      const onEvent = async (event: any) => {
        eventsReceived.push(event);
      };

      const subscriber = new SorobanSubscriber({
        rpc: rpcMock,
        cursorStore: cursorStoreMock,
        onEvent,
        xdrFormat: "base64",
      });

      await subscriber.pollOnce();

      expect(rpcMock.getEvents).toHaveBeenCalledWith(
        undefined,
        100,
        expect.any(AbortSignal),
        undefined,
        expect.objectContaining({ xdrFormat: "base64" }),
      );

      expect(eventsReceived).toHaveLength(1);
      expect(eventsReceived[0].value).toBe("AAAAEAAAAA5VbW91bnQAAAAAAA==");
      expect(eventsReceived[0].decodedData).toBeUndefined();
    });
  });
});
