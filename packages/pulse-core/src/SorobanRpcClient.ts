/**
 * Options for creating a SorobanRpcClient.
 */
export interface SorobanRpcClientOptions {
  /** The Soroban RPC server URL (e.g. a QuickNode or other hosted endpoint). */
  url: string;
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
  private readonly url: string;
  private readonly headers: Record<string, string>;

  /**
   * @param options - Configuration for the RPC client.
   */
  constructor(options: SorobanRpcClientOptions) {
    this.url = options.url;
    this.headers = { ...(options.headers ?? {}) };
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
   * @returns The JSON-RPC response body.
   */
  async request(method: string, params?: unknown): Promise<unknown> {
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

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Soroban RPC request failed: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Fetches Soroban events with optional cursor-based pagination.
   *
   * @param startCursor - Optional cursor to start fetching from.
   * @param limit - Optional maximum number of events to return.
   * @returns An object containing the events array.
   */
  async getEvents(
    startCursor?: string,
    limit?: number
  ): Promise<{ events: unknown[] }> {
    const params: Record<string, unknown> = {};
    if (startCursor !== undefined) params.startCursor = startCursor;
    if (limit !== undefined) params.limit = limit;

    const result = (await this.request("getEvents", params)) as {
      result?: { events?: unknown[] };
    };
    return { events: result?.result?.events ?? [] };
  }
}
