export type Span = {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
};

export type Tracer = {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): Span;
};

export type WebhookMetrics = {
  recordAttempt(url: string, attempt: number, durationMs: number, status: number | "timeout" | "error"): void;
  recordTerminal(url: string, outcome: "success" | "failed" | "dropped"): void;
};

import type { DeadLetterStore } from "./DeadLetterStore.js";

export type WebhookConfig = {
  url: string | string[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  /** Maximum number of concurrent in-flight retries. Defaults to 100. */
  maxConcurrentRetries?: number;
  /** Optional RNG for testing jitter. Defaults to `Math.random`. */
  random?: () => number;
  /** Optional OpenTelemetry-compatible tracer. When provided, one span is emitted per delivery attempt. */
  tracer?: Tracer;
  /** Optional custom URL validator for additional block-lists. Return an error message to reject, or null to allow. */
  urlValidator?: (url: string) => Promise<string | null>;
  /** Pluggable retry queue for durable webhooks replay. */
  retryQueue?: RetryQueue;
  /** Pluggable custom dead letter store for failed/dropped webhooks. */
  deadLetterStore?: DeadLetterStore;
  /** Optional metrics recorder for per-URL delivery observability. */
  metrics?: WebhookMetrics;
};

export const DEFAULT_MAX_AGE_MS = 300_000;
export const DEFAULT_CLOCK_SKEW_MS = 30_000;

export type VerifierSignatureVersion = "v1" | "v2";

export type VerifyWebhookOptions = {
  /** Reject signatures older than this age in milliseconds. Defaults to 300_000 (5 minutes). */
  maxAgeMs?: number;
  /** Clock skew allowance in milliseconds for sender/receiver clock differences. Defaults to 30_000. */
  clockSkewMs?: number;
  /** Override current time for testing. Defaults to Date.now(). */
  nowMs?: number;
  /** Signature version selector. `v2` is a reserved placeholder for a future x-orbital-signature-v2 format. Defaults to `v1`. */
  version?: VerifierSignatureVersion;
  /** Optional schema hook to validate the parsed `NormalizedEvent`. When provided, the verifier
   *  will run this after signature verification and return `null` if it returns `false`.
   */
  schema?: (event: import("@orbital/pulse-core").NormalizedEvent) => boolean;
};

export interface RetryRecord {
  id?: string | number;
  url: string;
  event: any;
  attempt: number;
  nextAttemptAt: number;
}

export interface RetryQueue {
  enqueue(record: RetryRecord): Promise<void>;
  dequeue(): Promise<RetryRecord | null>;
  evictNewest(): Promise<RetryRecord | null>;
  size(): Promise<number>;
}
