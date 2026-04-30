export type WebhookConfig = {
  url: string | string[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
};
