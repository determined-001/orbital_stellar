import type { Counter, Histogram, Meter, Attributes } from "@opentelemetry/api";

import type { DeliveryAttributes, WebhookMetrics } from "./metrics.js";

/**
 * OpenTelemetry reference adapter for {@link WebhookMetrics}.
 *
 * Construct it with a `Meter` (from `@opentelemetry/api`) and pass it to
 * `WebhookDelivery` via `config.metrics`. The adapter creates its instruments
 * once in the constructor and reuses them, as recommended by the OTel spec.
 *
 * ```ts
 * import { metrics } from "@opentelemetry/api";
 * const meter = metrics.getMeter("orbital-pulse-webhooks");
 * const delivery = new WebhookDelivery(watcher, {
 *   url, secret,
 *   metrics: new OtelWebhookMetrics(meter),
 * });
 * ```
 *
 * ## Instruments
 *
 * | Instrument                  | Kind      | Unit | Attributes                       |
 * |-----------------------------|-----------|------|----------------------------------|
 * | `webhook.deliveries`        | Counter   | `1`  | `outcome`, `host`, `event.type`  |
 * | `webhook.delivery.duration` | Histogram | `s`  | `host`, `event.type`             |
 * | `webhook.retries`           | Counter   | `1`  | `host`, `event.type`, `attempt`  |
 *
 * The `outcome` attribute on `webhook.deliveries` is one of `delivered`,
 * `failed`, or `dropped`, so a single counter covers every terminal state and
 * can be summed or split by outcome at query time.
 *
 * Durations are recorded in **seconds** to match OpenTelemetry's duration
 * convention, even though the interface hands them over in milliseconds.
 *
 * See `docs/metrics.md` for the full attribute conventions and the rationale
 * for excluding the full URL and payload.
 */
export class OtelWebhookMetrics implements WebhookMetrics {
  private readonly deliveries: Counter;
  private readonly duration: Histogram;
  private readonly retries: Counter;

  constructor(meter: Meter) {
    this.deliveries = meter.createCounter("webhook.deliveries", {
      description:
        "Count of terminal webhook delivery outcomes, split by `outcome`.",
      unit: "1",
    });
    this.duration = meter.createHistogram("webhook.delivery.duration", {
      description: "Latency of successful webhook deliveries.",
      unit: "s",
    });
    this.retries = meter.createCounter("webhook.retries", {
      description: "Count of scheduled webhook delivery retries.",
      unit: "1",
    });
  }

  onDelivered(durationMs: number, attrs: DeliveryAttributes): void {
    const a = base(attrs);
    this.deliveries.add(1, { ...a, outcome: "delivered" });
    // Interface reports ms; OTel duration convention is seconds.
    this.duration.record(durationMs / 1000, a);
  }

  onFailed(attrs: DeliveryAttributes): void {
    this.deliveries.add(1, { ...base(attrs), outcome: "failed" });
  }

  onDropped(attrs: DeliveryAttributes): void {
    this.deliveries.add(1, { ...base(attrs), outcome: "dropped" });
  }

  onRetry(attrs: DeliveryAttributes): void {
    this.retries.add(1, { ...base(attrs), attempt: attrs.attempt });
  }
}

/**
 * Map the provider-agnostic attribute names to OTel attribute keys. Keeping
 * this mapping in one place is what makes the conventions doc enforceable.
 */
function base(attrs: DeliveryAttributes): Attributes {
  return {
    host: attrs.host,
    "event.type": attrs.eventType,
  };
}
