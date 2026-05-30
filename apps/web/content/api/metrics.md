# Webhook delivery metrics

`@orbital/pulse-webhooks` can emit delivery metrics through a pluggable
[`WebhookMetrics`](../packages/pulse-webhooks/src/metrics.ts) sink. The package
ships one reference adapter — `OtelWebhookMetrics`, backed by OpenTelemetry —
and a `NoopWebhookMetrics` default so delivery works unchanged when no sink is
configured.

```ts
import { metrics } from "@opentelemetry/api";
import { WebhookDelivery, OtelWebhookMetrics } from "@orbital/pulse-webhooks";

const meter = metrics.getMeter("orbital-pulse-webhooks");

const delivery = new WebhookDelivery(watcher, {
  url: "https://hooks.example.com/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  metrics: new OtelWebhookMetrics(meter),
});
```

Wiring the meter up to an OTLP exporter (so the metrics reach a collector) is
the operator's responsibility and is standard OpenTelemetry setup — see the
`@opentelemetry/sdk-metrics` docs. The adapter only needs a `Meter`.

## Instruments

| Instrument                  | Kind      | Unit | Description                                            |
|-----------------------------|-----------|------|--------------------------------------------------------|
| `webhook.deliveries`        | Counter   | `1`  | Terminal delivery outcomes, split by the `outcome` attribute. |
| `webhook.delivery.duration` | Histogram | `s`  | Latency of successful deliveries, in **seconds**.      |
| `webhook.retries`           | Counter   | `1`  | Retries scheduled after a transient failure.           |

A single `webhook.deliveries` counter covers every terminal state via the
`outcome` attribute (`delivered` / `failed` / `dropped`) rather than three
separate counters. Sum it for total terminal deliveries, or split by `outcome`
for a success-rate panel.

## Attribute conventions

All instruments carry these attributes. They are deliberately **low
cardinality** — every value is bounded by the event-type union or a hostname,
never by an unbounded identifier.

| Attribute    | On                                | Values                                  |
|--------------|-----------------------------------|-----------------------------------------|
| `outcome`    | `webhook.deliveries`              | `delivered`, `failed`, `dropped`        |
| `host`       | all                               | Host of the target URL (e.g. `hooks.example.com`) |
| `event.type` | all                               | Normalized event type (e.g. `payment.received`) |
| `attempt`    | `webhook.retries`                 | 1-based attempt number                  |

### What is deliberately excluded, and why

- **The full target URL.** Only the `host` is recorded. URLs can embed
  credentials or signed tokens in the path/query; emitting them as a metric
  label would leak secrets into your metrics backend. The host is enough to
  attribute traffic to a destination.
- **The event payload and account addresses.** These are unbounded and would
  explode time-series cardinality, degrading the metrics backend. Per-event
  detail belongs in logs/traces, not metric labels.
- **`attempt` on the success and failure counters.** Attempt number is only
  attached to `webhook.retries`, where it is meaningful and stays small
  (bounded by `config.retries`). Putting it on every counter would multiply
  the series count for little value.

### Unit note: seconds vs milliseconds

The `WebhookMetrics` interface reports durations in **milliseconds** (matching
the rest of the codebase — `deliveryTimeoutMs`, `maxAgeMs`). The OTel adapter
converts to **seconds** when recording the histogram, because OpenTelemetry's
duration convention is seconds, and dashboards that overlay these metrics with
other OTel-instrumented services expect seconds. If you implement your own
`WebhookMetrics` adapter and prefer milliseconds, record `durationMs` directly.

## Writing your own adapter

`WebhookMetrics` is backend-agnostic. A Prometheus adapter, for instance, would
implement the same four methods against `prom-client` counters and a histogram,
following the same attribute conventions above so dashboards stay portable
across backends.
