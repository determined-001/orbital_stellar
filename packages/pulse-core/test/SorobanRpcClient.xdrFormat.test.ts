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
      expect(callOptions.signal).toBeInstanceOf(AbortSignal);
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params.xdrFormat).toBe("json");
    });

    it("uses constructor-level xdrFormat default", async () => {
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
        xdrFormat: "base64",
      });

      await client.getEvents("000001", 50);

      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params).toEqual({
        startCursor: "000001",
        limit: 50,
        xdrFormat: "base64",
      });
    });

    it("per-call xdrFormat overrides constructor-level default", async () => {
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
        xdrFormat: "base64",
      });

      await client.getEvents("000001", 50, { xdrFormat: "json" });

      const [, callOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(callOptions.body as string);
      expect(parsedBody.params).toEqual({
        startCursor: "000001",
        limit: 50,
        xdrFormat: "json",
      });
    });

    it("returns correctly shaped response without format interference", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: {
            events: [{ id: "evt-1", pagingToken: "000001", topic: ["transfer"] }],
            latestLedger: 100,
            cursor: "000001",
          },
        }),
      }) as unknown as typeof fetch;

      const client = new SorobanRpcClient({
        rpcUrl: "https://soroban-rpc.example.com",
        fetchImpl,
      });

      const result = await client.getEvents();

      expect(result).toEqual({
        events: [{ id: "evt-1", pagingToken: "000001", topic: ["transfer"] }],
        latestLedger: 100,
        cursor: "000001",
      });
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
      expect(result!.type).toBe("contract.emitted");

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
      expect(result!.type).toBe("contract.emitted");

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
      expect(result!.type).toBe("contract.emitted");

      const emitted = result as any;
      expect(emitted.value).toBe("");
      expect(emitted.decodedData).toEqual({ amount: 1000 });
    });

    it("sets decodedData from a base64 string value when xdrFormat is explicitly json", () => {
      const result = normalizeContractEvent(mockRawEvent, "json");
      expect(result).not.toBeNull();

      const emitted = result as any;
      expect(emitted.decodedData).toBe("AAAAEAAAAA5VbW91bnQAAAAAAA==");
      expect(emitted.value).toBe("");
    });

    it("preserves pre-set decodedData from prior dispatch step even in base64 mode", () => {
      const eventWithPrior = {
        ...mockRawEvent,
        value: { amount: 1000 },
        decodedData: { amount: 1000 },
      };
      const result = normalizeContractEvent(eventWithPrior, "base64");
      expect(result).not.toBeNull();

      const emitted = result as any;
      expect(emitted.decodedData).toEqual({ amount: 1000 });
      expect(emitted.value).toBe("");
    });

    it("defaults to base64 and preserves raw value when called without format argument", () => {
      const result = normalizeContractEvent(mockRawEvent);
      expect(result).not.toBeNull();

      const emitted = result as any;
      expect(emitted.value).toBe("AAAAEAAAAA5VbW91bnQAAAAAAA==");
      expect(emitted.decodedData).toBeUndefined();
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

    it("defaults to json when xdrFormat option is omitted at subscriber level", async () => {
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
  });
});
