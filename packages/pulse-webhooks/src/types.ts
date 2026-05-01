export type WebhookConfig = {
  url: string | string[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  /** Optional RNG for testing jitter. Defaults to `Math.random`. */
  random?: () => number;
};

