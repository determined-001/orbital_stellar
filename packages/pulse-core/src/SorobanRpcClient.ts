import type { ContractSubscriptionFilter, Logger } from "./index.js";
import { SorobanRpcError, type SorobanRpcErrorCode } from "./errors.js";

export type SorobanNetworkInfo = {
  friendbotUrl?: string;
  passphrase: string;
  protocolVersion?: number;
};

/**
 * Options for creating a SorobanRpcClient.
 */
export interface SorobanRpcClientOptions {
  /** The Soroban RPC server URL (e.g. a QuickNode or other hosted endpoint). */
  url?: string;
  /** Alias for {@link SorobanRpcClientOptions.url}. */
  rpcUrl?: string;
  /**
   * Optional HTTP headers to forward on every request.
   *
   * The recommended authentication pattern is:
   * ```ts
   * headers: { Authorization: "Bearer <your-api-key>" }
   * ```
   *
   * **Security:** Header values are automatically redacted (`[REDACTED]`) in
   * any log output to prevent credential leakage.
   */
  headers?: Record<string, string>;
  /** Injectable `fetch` implementation (for testing). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Optional logger. Per-request diagnostics go to `logger.debug` (header values redacted). */
  logger?: Logger;
}

/** Result of a `getEvents` call: the JSON-RPC `result` payload with `events` guaranteed. */
export type SorobanGetEventsResult = {
  events: unknown[];
  latestLedger?: number;
  cursor?: string;
  [key: string]: unknown;
};

/** Maps an HTTP status code to a {@link SorobanRpcError} classification. */
function classifyHttpStatus(status: number): {
  code: SorobanRpcErrorCode;
  retryable: boolean;
} {
  if (status === 429) return { code: "rate_limit", retryable: true };
  if (status === 401 || status === 403) return { code: "auth", retryable: false };
  if (status >= 500) return { code: "server", retryable: true };
  if (status >= 400) return { code: "invalid_request", retryable: false };
  return { code: "unknown", retryable: false };
}

/**
 * Maps a JSON-RPC 2.0 error code to a {@link SorobanRpcError} classification.
 *
 * Server errors (the -32000…-32099 implementation-defined range) are treated as
 * transient/retryable; the reserved protocol codes (invalid request, method not
 * found, invalid params, parse error) are terminal.
 */
function classifyJsonRpcCode(code: number): {
  code: SorobanRpcErrorCode;
  retryable: boolean;
} {
  if (code <= -32000 && code >= -32099) return { code: "server", retryable: true };
  return { code: "invalid_request", retryable: false };
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    if ((err as { name?: string }).name === "AbortError") return true;
    if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return true;
  }
  return false;
}

/**
 * Client for connecting to Soroban RPC providers.
 *
 * Supports authenticated endpoints via configurable headers. Every request
 * includes the configured headers, and sensitive header values are
 * automatically redacted from log output. Transport, HTTP, and JSON-RPC
 * failures are normalized into a classified {@link SorobanRpcError} so callers
 * can distinguish retryable from terminal conditions.
 *
 * @example
 * ```ts
 * const client = new SorobanRpcClient({
 *   url: "https://soroban-rpc.quicknode.com/...",
 *   headers: { Authorization: "Bearer your-api-key" },
 * });
 *
 * const { events } = await client.getEvents();
 * ```
 */
export class SorobanRpcClient {
  private static cachedNetwork: SorobanNetworkInfo | null = null;

  static setCachedNetwork(info: SorobanNetworkInfo | null): void {
    SorobanRpcClient.cachedNetwork = info;
  }

  static getCachedNetwork(): SorobanNetworkInfo | null {
    return SorobanRpcClient.cachedNetwork;
  }

  static getNetwork(): SorobanNetworkInfo {
    if (!SorobanRpcClient.cachedNetwork) {
      throw new Error("SorobanRpcClient.getNetwork() called before network info was cached.");
    }
    return SorobanRpcClient.cachedNetwork;
  }

  static async fetchAndCacheNetwork(_url: string): Promise<SorobanNetworkInfo> {
    throw new Error("fetchAndCacheNetwork not implemented");
  }

  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl?: typeof fetch;
  private readonly logger?: Logger;

  /**
   * @param options - Configuration for the RPC client.
   */
  constructor(options: SorobanRpcClientOptions) {
    this.url = (options.rpcUrl ?? options.url) as string;
    this.headers = { ...(options.headers ?? {}) };
    this.fetchImpl = options.fetchImpl;
    this.logger = options.logger;
  }

  /**
   * Returns a copy of the configured headers with all values replaced by
   * `[REDACTED]` so they can be safely included in log output.
   */
  private getRedactedHeaders(): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const key of Object.keys(this.headers)) {
      redacted[key] = "[REDACTED]";
    }
    return redacted;
  }

  /**
   * Sends a JSON-RPC 2.0 POST request to the Soroban RPC endpoint.
   *
   * Transport failures, non-OK HTTP responses, malformed JSON, and JSON-RPC
   * error bodies are all surfaced as a classified {@link SorobanRpcError}.
   *
   * @param method - The JSON-RPC method name.
   * @param params - Optional JSON-RPC parameters.
   * @param signal - Optional AbortSignal.
   * @returns The JSON-RPC response body.
   */
  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });

    this.logger?.debug?.("[SorobanRpcClient] sending request", {
      method,
      headers: this.getRedactedHeaders(),
    });

    const fetchImpl = this.fetchImpl ?? globalThis.fetch;

    let response: Response;
    try {
      response = await fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body,
        signal,
      });
    } catch (err) {
      if (err instanceof SorobanRpcError) throw err;
      // Preserve abort semantics so callers can detect graceful shutdown.
      if (isAbortError(err)) throw err;
      throw new SorobanRpcError(
        `Soroban RPC network error: ${err instanceof Error ? err.message : String(err)}`,
        { code: "network", retryable: true, cause: err },
      );
    }

    if (!response.ok) {
      const { code, retryable } = classifyHttpStatus(response.status);
      throw new SorobanRpcError(
        `Soroban RPC request failed: ${response.status} ${response.statusText}`,
        { code, retryable, status: response.status },
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (err) {
      throw new SorobanRpcError("Soroban RPC returned malformed JSON", {
        code: "invalid_request",
        retryable: false,
        cause: err,
      });
    }

    // Surface JSON-RPC error envelopes as classified errors.
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      const rpcError = (parsed as { error?: { code?: number; message?: string } }).error;
      if (rpcError) {
        const { code, retryable } = classifyJsonRpcCode(rpcError.code ?? 0);
        throw new SorobanRpcError(rpcError.message ?? "Soroban RPC returned a JSON-RPC error", {
          code,
          retryable,
        });
      }
    }

    return parsed;
  }

  /**
   * Fetches Soroban events with optional cursor-based pagination and filters.
   *
   * @param startCursor - Optional cursor to start fetching from.
   * @param limit - Optional maximum number of events to return.
   * @param signal - Optional AbortSignal.
   * @param filters - Optional array of filters (up to 5 filters).
   * @returns The JSON-RPC `result` payload, with `events` defaulting to `[]`.
   */
  async getEvents(
    startCursor?: string,
    limit?: number,
    signal?: AbortSignal,
    filters?: ContractSubscriptionFilter[],
  ): Promise<SorobanGetEventsResult> {
    const params: Record<string, unknown> = {};
    if (startCursor !== undefined) params.startCursor = startCursor;
    if (limit !== undefined) params.limit = limit;
    if (filters !== undefined && filters.length > 0) params.filters = filters;

    const body = (await this.request("getEvents", params, signal)) as {
      result?: Partial<SorobanGetEventsResult>;
    };

    return { events: [], ...(body?.result ?? {}) };
  }
}
