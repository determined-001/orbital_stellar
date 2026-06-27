import { useState, useEffect, useRef, useCallback } from "react";
import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { acquireEventConnection } from "./connectionPool.js";

export type ContractStateOptions<T = unknown> = {
  pollIntervalMs?: number;
  autoRefreshOn?: {
    serverUrl: string;
    contractId: string;
    filter?: (event: ContractEmittedEvent) => boolean;
    token?: string;
  };
  headers?: Record<string, string>;
};

export type ContractStateResult<T = unknown> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

async function getLedgerEntry(
  rpcUrl: string,
  key: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntry",
      params: { key },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC request failed: ${response.status} ${response.statusText}`);
  }

  const json: { result?: unknown; error?: { message?: string } } = await response.json();
  if (json.error) {
    throw new Error(json.error.message ?? "Soroban RPC returned an error");
  }
  return json.result;
}

export function useContractState<T = unknown>(
  rpcUrl: string,
  contractId: string,
  key: string,
  options?: ContractStateOptions<T>,
): ContractStateResult<T> {
  const pollIntervalMs = options?.pollIntervalMs ?? 10_000;
  const autoRefreshOn = options?.autoRefreshOn;
  const headers = options?.headers;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const headersRef = useRef(headers);
  useEffect(() => {
    headersRef.current = headers;
  });

  const autoRefreshFilterRef = useRef(autoRefreshOn?.filter);
  useEffect(() => {
    autoRefreshFilterRef.current = autoRefreshOn?.filter;
  });

  const fetchState = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await getLedgerEntry(rpcUrl, key, headersRef.current, controller.signal);
      if (!controller.signal.aborted) {
        setData(result as T);
        setLoading(false);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [rpcUrl, key]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, pollIntervalMs);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchState, pollIntervalMs]);

  const autoRefreshServerUrl = autoRefreshOn?.serverUrl;
  const autoRefreshContractId = autoRefreshOn?.contractId;
  const autoRefreshToken = autoRefreshOn?.token;

  useEffect(() => {
    if (!autoRefreshServerUrl || !autoRefreshContractId) return;

    const connection = acquireEventConnection(
      {
        serverUrl: autoRefreshServerUrl,
        address: autoRefreshContractId,
        token: autoRefreshToken,
      },
      {
        onOpen: () => {},
        onEvent: (event) => {
          if (event.type !== "contract.emitted") return;
          if (
            autoRefreshFilterRef.current &&
            !autoRefreshFilterRef.current(event as ContractEmittedEvent)
          ) {
            return;
          }
          fetchState();
        },
        onParseError: () => {},
        onError: () => {},
      },
    );

    return () => {
      connection.unsubscribe();
    };
  }, [autoRefreshServerUrl, autoRefreshContractId, autoRefreshToken, fetchState]);

  return { data, loading, error, refetch: fetchState };
}
