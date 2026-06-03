function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export class HorizonStreamError extends Error {
  readonly status?: number;
  readonly statusCode?: number;
  readonly response?: {
    status?: number;
    statusCode?: number;
    headers?: unknown;
  };
  readonly headers?: unknown;

  constructor(error: unknown) {
    super(
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "[pulse-core] Horizon SSE stream error"
    );
    this.name = "HorizonStreamError";

    if (isRecord(error)) {
      const status = toNumber(error.status ?? error.statusCode);
      const statusCode = toNumber(error.statusCode ?? error.status);
      if (status !== undefined) this.status = status;
      if (statusCode !== undefined) this.statusCode = statusCode;

      if (isRecord(error.headers)) {
        this.headers = error.headers;
      }

      const response = error.response;
      if (isRecord(response)) {
        this.response = {
          status: toNumber(response.status ?? response.statusCode),
          statusCode: toNumber(response.statusCode ?? response.status),
          headers: response.headers,
        };
      }
    }
  }
}

export class EngineAlreadyStartedError extends Error {
  constructor() {
    super("[pulse-core] EventEngine.start() called while the SSE stream is already active.");
    this.name = "EngineAlreadyStartedError";
  }
}

export class NetworkMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`[pulse-core] Soroban RPC network mismatch: expected passphrase "${expected}", got "${actual}"`);
    this.name = "NetworkMismatchError";
  }
}