import type { RetryQueue } from "./RetryQueue.js";

export type { RetryRecord, RetryQueue } from "./RetryQueue.js";

export type WebhookConfig = {
  url: string | string[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  maxConcurrentRetries?: number;
  random?: () => number;
  urlValidator?: (url: string) => Promise<string | null>;
  retryQueue?: RetryQueue;
};

export const DEFAULT_MAX_AGE_MS = 300_000;
export const DEFAULT_CLOCK_SKEW_MS = 30_000;

export type VerifyWebhookOptions = {
  maxAgeMs?: number;
  clockSkewMs?: number;
  nowMs?: number;
};
