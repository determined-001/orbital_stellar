import type { ContractSubscriptionFilter, Logger } from "./index.js";
import { SorobanRpcError, type SorobanRpcErrorCode } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10_000;

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
  fetch?: typeof fetch;
  /** Injectable `fetch` implementation (for testing). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Optional logger. Per-request diagnostics go to `logger.debug` (header values redacted). */
  logger?: Logger;
}

export type SorobanEventXdrFormat = "base64" | "json";

export type SorobanEventFilter = {
  type?: "contract" | "system" | "diagnostic" | "contract.invoked" | "contract.emitted";
  contractIds?: string[];
  topics?: Array<Array<string | null>>;
  topicFilters?: Array<string | null>;
};

export type SorobanGetEventsParams = {
  startLedger?: number;
  cursor?: string;
  startCursor?: string;
  filters?: SorobanEventFilter[] | ContractSubscriptionFilter[];
  limit?: number;
  xdrFormat?: SorobanEventXdrFormat;
};

export type SorobanRpcCallOptions = {
  signal?: AbortSignal;
};

export type SorobanRpcEvent = {
  type: string;
  ledger: number;
  ledgerClosedAt?: string;
  contractId?: string;
  id: string;
  pagingToken?: string;
  topic?: unknown[];
  topics?: unknown[];
  value?: unknown;
  txHash?: string;
  inSuccessfulContractCall?: boolean;
  [key: string]: unknown;
};

export type SorobanGetEventsResult = {
  events: SorobanRpcEvent[];
  latestLedger?: number;
  cursor?: string;
  [key: string]: unknown;
};

export type SorobanLatestLedgerResult = {
  id?: string;
  protocolVersion?: number;
  sequence: number;
};

export type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
};

export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

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
    if ((err as { name?: string }).name === "TimeoutError") return true;
    if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return true;
  }
  return false;
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" && value !== null && "aborted" in value && "addEventListener" in value
  );
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
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  /**
   * @param options - Configuration for the RPC client.
   */
  constructor(options: SorobanRpcClientOptions) {
    const url = options.rpcUrl ?? options.url;
    if (!url) {
      throw new TypeError("SorobanRpcClient requires a url.");
    }
    this.url = url;
    this.headers = { ...(options.headers ?? {}) };
    this.fetchImpl = options.fetch ?? options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new TypeError("SorobanRpcClient requires a fetch implementation.");
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
   * @param signal - Optional AbortSignal for request cancellation.
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

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(createAbortError(`Soroban RPC request timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);
    const abortFromCaller = () => {
      controller.abort(signal?.reason ?? createAbortError("Soroban RPC request aborted"));
    };

    if (signal?.aborted) {
      clearTimeout(timeout);
      throw signal.reason ?? createAbortError("Soroban RPC request aborted");
    }
    signal?.addEventListener("abort", abortFromCaller, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof SorobanRpcError) throw err;
      // Preserve abort semantics so callers can detect graceful shutdown.
      if (isAbortError(err)) throw err;
      throw new SorobanRpcError(
        `Soroban RPC network error: ${err instanceof Error ? err.message : String(err)}`,
        { code: "network", retryable: true, cause: err },
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
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

  private async requestResult<T>(
    method: string,
    params?: unknown,
    options?: SorobanRpcCallOptions,
  ): Promise<T> {
    const body = (await this.request(method, params, options?.signal)) as JsonRpcResponse<T>;
    if (!body || typeof body !== "object" || !("result" in body)) {
      throw new SorobanRpcError("Soroban RPC response did not include a result", {
        code: "invalid_request",
        retryable: false,
      });
    }
    return body.result;
  }

  /**
   * Fetches Soroban events with optional cursor-based pagination and filters.
   *
   * @param startCursor - Optional cursor to start fetching from.
   * @param limit - Optional maximum number of events to return.
   * @param signalOrOptions - Optional AbortSignal or option bag (e.g. xdrFormat: 'base64' | 'json', signal: AbortSignal).
   * @param filters - Optional array of filters (up to 5 filters).
   * @param options - Optional configuration options (e.g. xdrFormat: 'base64' | 'json', signal: AbortSignal).
   * @returns The JSON-RPC `result` payload, with `events` defaulting to `[]`.
   */
  async getEvents(
    params?: SorobanGetEventsParams,
    options?: SorobanRpcCallOptions,
  ): Promise<SorobanGetEventsResult>;
  async getEvents(
    startCursor?: string,
    limit?: number,
    signalOrOptions?: AbortSignal | { xdrFormat?: "base64" | "json"; signal?: AbortSignal },
    filters?: ContractSubscriptionFilter[],
    options?: { xdrFormat?: "base64" | "json"; signal?: AbortSignal } | AbortSignal,
  ): Promise<SorobanGetEventsResult>;
  async getEvents(
    first?: string | SorobanGetEventsParams,
    limit?: number | SorobanRpcCallOptions,
    signalOrOptions?: AbortSignal | { xdrFormat?: "base64" | "json"; signal?: AbortSignal },
    filters?: ContractSubscriptionFilter[],
    options?: { xdrFormat?: "base64" | "json"; signal?: AbortSignal } | AbortSignal,
  ): Promise<SorobanGetEventsResult> {
    let params: Record<string, unknown> = {};
    let signal: AbortSignal | undefined = undefined;

    if (typeof first === "object" && first !== null && !isAbortSignal(first)) {
      params = { ...first };
      if (typeof limit === "object" && limit !== null && "signal" in limit) {
        signal = limit.signal;
      }
    } else {
      if (first !== undefined) params.startCursor = first;
      if (typeof limit === "number") params.limit = limit;
      if (filters !== undefined && filters.length > 0) params.filters = filters;
    }

    let xdrFormat: "base64" | "json" = "json";
    if (typeof params.xdrFormat === "string") {
      xdrFormat = params.xdrFormat as "base64" | "json";
    }

    // Resolve signal or options from the third parameter
    if (signalOrOptions !== undefined) {
      if (isAbortSignal(signalOrOptions)) {
        signal = signalOrOptions as AbortSignal;
      } else if (typeof signalOrOptions === "object" && signalOrOptions !== null) {
        if ("xdrFormat" in signalOrOptions) {
          xdrFormat = (signalOrOptions as any).xdrFormat ?? "json";
        }
        if ("signal" in signalOrOptions) {
          signal = (signalOrOptions as any).signal;
        }
      }
    }

    // Resolve signal or options from the fifth parameter (options)
    if (options !== undefined) {
      if (isAbortSignal(options)) {
        signal = options as AbortSignal;
      } else if (typeof options === "object" && options !== null) {
        if ("xdrFormat" in options) {
          xdrFormat = (options as any).xdrFormat ?? "json";
        }
        if ("signal" in options) {
          signal = (options as any).signal;
        }
      }
    }

    params.xdrFormat = xdrFormat;

    const result = await this.requestResult<Partial<SorobanGetEventsResult>>("getEvents", params, {
      signal,
    });

    return { events: [], ...result };
  }

  async getLatestLedger(options?: SorobanRpcCallOptions): Promise<number> {
    const result = await this.requestResult<SorobanLatestLedgerResult>(
      "getLatestLedger",
      undefined,
      options,
    );
    return result.sequence;
  }

  async getNetwork(options?: SorobanRpcCallOptions): Promise<SorobanNetworkInfo> {
    const result = await this.requestResult<SorobanNetworkInfo>("getNetwork", undefined, options);
    SorobanRpcClient.setCachedNetwork(result);
    return result;
  }
}
