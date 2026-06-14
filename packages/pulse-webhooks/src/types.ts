import type { RetryQueue, RetryRecord } from "./RetryQueue.js";

export type { RetryRecord, RetryQueue } from "./RetryQueue.js";

export type Span = {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
};

export type Tracer = {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): Span;
};

export type WebhookAttemptStatus = "success" | "failure";

export type WebhookTerminalOutcome = "success" | "failure" | "dropped";

export type WebhookMetrics = {
  recordAttempt(
    url: string,
    attempt: number,
    durationMs: number,
    status: WebhookAttemptStatus,
  ): void;
  recordTerminal(url: string, outcome: WebhookTerminalOutcome): void;
};

export type WebhookConfig = {
  url: string | string[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  maxConcurrentRetries?: number;
  random?: () => number;
  backoff?: import("./backoff.js").BackoffStrategy;
  tracer?: Tracer;
  urlValidator?: (url: string) => Promise<string | null>;
  metrics?: WebhookMetrics;
  retryQueue?: RetryQueue;
};

export const DEFAULT_MAX_AGE_MS = 300_000;
export const DEFAULT_CLOCK_SKEW_MS = 30_000;

export type VerifierSignatureVersion = "v1" | "v2";

export type VerifyWebhookOptions = {
  maxAgeMs?: number;
  clockSkewMs?: number;
  nowMs?: number;
  version?: VerifierSignatureVersion;
  schema?: (event: import("@orbital-stellar/pulse-core").NormalizedEvent) => boolean;
};