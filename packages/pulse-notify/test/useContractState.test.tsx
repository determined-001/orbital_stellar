import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useContractState } from "../src/index.ts";
import {
  __resetConnectionPoolForTests,
  __getConnectionPoolSizeForTests,
} from "../src/connectionPool.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
  close() {
    this.closeCount += 1;
  }
}

const RPC_URL = "https://soroban-rpc.example.com";
const CONTRACT_ID = "CA3D5R2WQ2VKJ3X5QYG4Z6J7K8L9M0N1P2Q3R4S5";
const KEY = "AAAAAQAAAAU=";

function mockFetchOnce(data: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ result: data }),
  });
}

function mockFetchErrorOnce(status: number, statusText: string) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  });
}

let originalEventSource: typeof globalThis.EventSource;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  originalFetch = globalThis.fetch;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  MockEventSource.instances = [];
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
  __resetConnectionPoolForTests();
  vi.restoreAllMocks();
});

describe("useContractState", () => {
  it("fetches ledger entry on mount and returns data", async () => {
    const ledgerData = { xdr: "AAAAAA==", lastModifiedLedgerSeq: 123 };
    globalThis.fetch = mockFetchOnce(ledgerData);

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(ledgerData);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refetch).toBe("function");
  });

  it("sets loading to true on mount and switches to false after fetch", async () => {
    const ledgerData = { xdr: "AAAAAA==", lastModifiedLedgerSeq: 123 };

    let resolvePromise: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    globalThis.fetch = vi.fn().mockReturnValueOnce({
      ok: true,
      json: () => fetchPromise.then(() => ({ result: ledgerData })),
    });

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolvePromise!(undefined);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(ledgerData);
  });

  it("sets error when fetch fails with HTTP error", async () => {
    globalThis.fetch = mockFetchErrorOnce(400, "Bad Request");

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("400");
    expect(result.current.error).toContain("Bad Request");
    expect(result.current.data).toBeNull();
  });

  it("sets error when RPC returns an error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: "Invalid key" } }),
    });

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Invalid key");
  });

  it("returns data null and loading true initially", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("refetch re-fetches data and updates state", async () => {
    globalThis.fetch = mockFetchOnce({ xdr: "AAAAAA==", seq: 1 });

    const { result } = renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.data as any)?.seq).toBe(1);

    globalThis.fetch = mockFetchOnce({ xdr: "BBBBBB==", seq: 2 });

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.data as any)?.seq).toBe(2);
  });

  it("polls at configured interval", async () => {
    vi.useFakeTimers();

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { xdr: "AAAAAA==", seq: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { xdr: "BBBBBB==", seq: 2 } }),
      });

    globalThis.fetch = fetchFn;

    renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY, { pollIntervalMs: 5000 }));

    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("passes custom headers to the fetch request", async () => {
    const ledgerData = { xdr: "AAAAAA==" };
    globalThis.fetch = mockFetchOnce(ledgerData);

    const headers = { Authorization: "Bearer test-token" };

    renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY, { headers }));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].headers["Authorization"]).toBe("Bearer test-token");
    });
  });

  it("sends correct JSON-RPC body", async () => {
    const ledgerData = { xdr: "AAAAAA==" };
    globalThis.fetch = mockFetchOnce(ledgerData);

    renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(RPC_URL);
      const body = JSON.parse(call[1].body);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("getLedgerEntry");
      expect(body.params.key).toBe(KEY);
    });
  });

  describe("autoRefreshOn", () => {
    const EVENT_SERVER = "https://events.example.com";

    it("connects to event stream when autoRefreshOn is configured", async () => {
      globalThis.fetch = mockFetchOnce({ xdr: "AAAAAA==" });

      renderHook(() =>
        useContractState(RPC_URL, CONTRACT_ID, KEY, {
          autoRefreshOn: {
            serverUrl: EVENT_SERVER,
            contractId: CONTRACT_ID,
          },
        }),
      );

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBe(1);
        expect(MockEventSource.instances[0]!.url).toContain(CONTRACT_ID);
      });
    });

    it("does not connect to event stream when autoRefreshOn is not set", async () => {
      globalThis.fetch = mockFetchOnce({ xdr: "AAAAAA==" });

      renderHook(() => useContractState(RPC_URL, CONTRACT_ID, KEY));

      await waitFor(() => expect(fetch).toHaveBeenCalled());

      expect(MockEventSource.instances.length).toBe(0);
    });

    it("refetches on matching contract.emitted event", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: { xdr: "AAAAAA==", seq: 1 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: { xdr: "BBBBBB==", seq: 2 } }),
        });

      globalThis.fetch = fetchFn;

      const { result } = renderHook(() =>
        useContractState(RPC_URL, CONTRACT_ID, KEY, {
          autoRefreshOn: {
            serverUrl: EVENT_SERVER,
            contractId: CONTRACT_ID,
          },
        }),
      );

      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect((result.current.data as any)?.seq).toBe(1);
      });

      const source = MockEventSource.instances[0]!;
      source.onopen?.();

      act(() => {
        source.onmessage?.({
          data: JSON.stringify({
            type: "contract.emitted",
            contractId: CONTRACT_ID,
            topics: [],
            data: "hello",
            timestamp: "2026-01-01T00:00:00Z",
          }),
        });
      });

      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect((result.current.data as any)?.seq).toBe(2);
      });
    });

    it("does not refetch on non-contract.emitted events", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { xdr: "AAAAAA==" } }),
      });

      globalThis.fetch = fetchFn;

      renderHook(() =>
        useContractState(RPC_URL, CONTRACT_ID, KEY, {
          autoRefreshOn: {
            serverUrl: EVENT_SERVER,
            contractId: CONTRACT_ID,
          },
        }),
      );

      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledTimes(1);
      });

      const source = MockEventSource.instances[0]!;
      source.onopen?.();

      act(() => {
        source.onmessage?.({
          data: JSON.stringify({
            type: "payment.received",
            timestamp: "2026-01-01T00:00:00Z",
          }),
        });
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);

      act(() => {
        source.onmessage?.({
          data: JSON.stringify({
            type: "contract.invoked",
            contractId: CONTRACT_ID,
            timestamp: "2026-01-01T00:00:00Z",
          }),
        });
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("uses filter to determine which events trigger refetch", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { xdr: "AAAAAA==" } }),
      });

      globalThis.fetch = fetchFn;

      const filter = vi.fn().mockReturnValue(false);

      renderHook(() =>
        useContractState(RPC_URL, CONTRACT_ID, KEY, {
          autoRefreshOn: {
            serverUrl: EVENT_SERVER,
            contractId: CONTRACT_ID,
            filter,
          },
        }),
      );

      await waitFor(() => {
        expect(fetchFn).toHaveBeenCalledTimes(1);
      });

      const source = MockEventSource.instances[0]!;
      source.onopen?.();

      act(() => {
        source.onmessage?.({
          data: JSON.stringify({
            type: "contract.emitted",
            contractId: CONTRACT_ID,
            topics: ["balance"],
            timestamp: "2026-01-01T00:00:00Z",
          }),
        });
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(filter).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes from event stream on unmount", async () => {
      globalThis.fetch = mockFetchOnce({ xdr: "AAAAAA==" });

      const { unmount } = renderHook(() =>
        useContractState(RPC_URL, CONTRACT_ID, KEY, {
          autoRefreshOn: {
            serverUrl: EVENT_SERVER,
            contractId: CONTRACT_ID,
          },
        }),
      );

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBe(1);
      });

      unmount();

      await waitFor(() => {
        expect(MockEventSource.instances[0]?.closeCount).toBe(1);
      });

      expect(__getConnectionPoolSizeForTests()).toBe(0);
    });
  });
});
