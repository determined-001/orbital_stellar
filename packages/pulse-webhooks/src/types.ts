export type WebhookConfig = {
  url: string;
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  /** Maximum number of concurrent in-flight retries. Defaults to 100. */
  maxConcurrentRetries?: number;
};
