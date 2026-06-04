import type { ContractSubscriptionFilter } from "./index.js";
import type { SorobanEvent } from "./SorobanSubscriber.js";
import { SorobanRpcError } from "./errors.js";

export type SorobanRpcEvent = SorobanEvent;

export interface SorobanGetEventsResponse {
  events: SorobanRpcEvent[];
}


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
  fetchImpl?: typeof fetch;
}

/**
 * Client for connecting to Soroban RPC providers.
 *
 * Supports authenticated endpoints via configurable headers. Every request
 * includes the configured headers, and sensitive header values are
 * automatically redacted from log output.
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

  /** Set the process-cached network information (used in tests or initialization). */
  static setCachedNetwork(info: SorobanNetworkInfo | null): void {
    SorobanRpcClient.cachedNetwork = info;
  }

  /** Returns the cached network info or null if none is cached. */
  static getCachedNetwork(): SorobanNetworkInfo | null {
    return SorobanRpcClient.cachedNetwork;
  }

  /**
   * Synchronous getter used by EventEngine.start() to detect network drift.
   * Returns the cached value or throws if no cached value is available.
   * Tests set the cache directly via setCachedNetwork().
   */
  static getNetwork(): SorobanNetworkInfo {
    if (!SorobanRpcClient.cachedNetwork) {
      throw new Error("SorobanRpcClient.getNetwork() called before network info was cached.");
    }
    return SorobanRpcClient.cachedNetwork;
  }

  /**
   * Placeholder async fetcher (not used in these tests). In production this
   * would call the RPC /network endpoint and cache the result.
   */
  static async fetchAndCacheNetwork(_url: string): Promise<SorobanNetworkInfo> {
    // Not implemented here; callers may stub this in tests or call setCachedNetwork.
    throw new Error("fetchAndCacheNetwork not implemented");
  }

  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl?: typeof fetch;

  /**
   * @param options - Configuration for the RPC client.
   */
  constructor(options: SorobanRpcClientOptions) {
    this.url = options.url ?? options.rpcUrl ?? "";
    this.headers = { ...(options.headers ?? {}) };
    this.fetchImpl = options.fetchImpl;
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

    console.log(
      "[SorobanRpcClient] Sending request:",
      method,
      "with headers:",
      this.getRedactedHeaders()
    );

    let response: Response;
    try {
      response = await (this.fetchImpl ?? fetch)(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body,
        signal,
      });
    } catch (fetchErr) {
      throw new SorobanRpcError(
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        { code: "network", retryable: true, cause: fetchErr }
      );
    }

    if (!response.ok) {
      const status = response.status;
      let code: "rate_limit" | "auth" | "invalid_request" | "server" | "unknown" = "unknown";
      let retryable = false;

      if (status === 429) {
        code = "rate_limit";
        retryable = true;
      } else if (status === 401 || status === 403) {
        code = "auth";
        retryable = false;
      } else if (status === 400 || status === 404) {
        code = "invalid_request";
        retryable = false;
      } else if (status >= 500) {
        code = "server";
        retryable = true;
      }

      throw new SorobanRpcError(
        `Soroban RPC request failed: ${response.status} ${response.statusText}`,
        { code, retryable, status }
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch (jsonErr) {
      throw new SorobanRpcError(
        `Failed to parse JSON response: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`,
        { code: "invalid_request", retryable: false, cause: jsonErr }
      );
    }

    if (json && typeof json === "object" && json.error) {
      const err = json.error;
      const code = typeof err.code === "number" ? err.code : 0;
      const message = typeof err.message === "string" ? err.message : "JSON-RPC error";
      
      let mappedCode: "server" | "invalid_request" = "invalid_request";
      let retryable = false;

      if (code === -32603 || (code >= -32099 && code <= -32000)) {
        mappedCode = "server";
        retryable = true;
      }

      throw new SorobanRpcError(message, { code: mappedCode, retryable, cause: err });
    }

    return json;
  }

  /**
   * Fetches Soroban events with optional cursor-based pagination and filters.
   *
   * @param startCursor - Optional cursor to start fetching from.
   * @param limit - Optional maximum number of events to return.
   * @param signal - Optional AbortSignal.
   * @param filters - Optional array of filters (up to 5 filters).
   * @returns An object containing the events array.
   */
  async getEvents(
    startCursor?: string,
    limit?: number,
    signal?: AbortSignal,
    filters?: ContractSubscriptionFilter[]
  ): Promise<{ events: unknown[]; latestLedger?: number; cursor?: string }> {
    const params: Record<string, unknown> = {};
    if (startCursor !== undefined) params.startCursor = startCursor;
    if (limit !== undefined) params.limit = limit;
    if (filters !== undefined && filters.length > 0) params.filters = filters;

    const result = (await this.request("getEvents", params, signal)) as {
      result?: { events?: unknown[]; latestLedger?: number; cursor?: string };
    };
    return {
      events: result?.result?.events ?? [],
      latestLedger: result?.result?.latestLedger,
      cursor: result?.result?.cursor,
    };
  }
}
