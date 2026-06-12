export type WebhookAttemptStatus = "success" | "failure";
export type WebhookTerminalOutcome = "success" | "failure";

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
  /** Maximum number of concurrent in-flight retries. Defaults to 100. */
  maxConcurrentRetries?: number;
  /** Optional RNG for testing jitter. Defaults to `Math.random`. */
  random?: () => number;
  /** Retry delay strategy. Defaults to `exponentialJittered`. */
  backoff?: import("./backoff.js").BackoffStrategy;
  /** Optional OpenTelemetry-compatible tracer. When provided, one span is emitted per delivery attempt. */
  tracer?: any;
  /** Optional custom URL validator for additional block-lists. Return an error message to reject, or null to allow. */
  urlValidator?: (url: string) => Promise<string | null>;
  /** Optional metrics observer for webhook delivery attempts and terminal outcomes. */
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
  schema?: (event: import("@orbital-stellar/pulse-core").NormalizedEvent) => boolean;
};
