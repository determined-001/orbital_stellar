import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import type {
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { ExportResult } from "@opentelemetry/core";

import { OtelWebhookMetrics } from "../src/OtelWebhookMetrics.js";
import type { DeliveryAttributes } from "../src/metrics.js";

/**
 * In-memory stand-in for an OTLP collector. The reader pushes the same
 * `ResourceMetrics` batch here that it would serialize and ship over the wire,
 * so asserting on what lands here is equivalent to asserting on what a real
 * collector would receive.
 */
class CollectingExporter implements PushMetricExporter {
  readonly batches: ResourceMetrics[] = [];
  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.batches.push(metrics);
    resultCallback({ code: 0 });
  }
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.CUMULATIVE;
  }
}

const attrs: DeliveryAttributes = {
  host: "hooks.example.com",
  eventType: "payment.received",
  attempt: 1,
};

function collectMetricNames(batch: ResourceMetrics): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const scope of batch.scopeMetrics) {
    for (const m of scope.metrics) {
      out.set(m.descriptor.name, m);
    }
  }
  return out;
}

describe("OtelWebhookMetrics integration (exports to a collector)", () => {
  let provider: MeterProvider;
  let exporter: CollectingExporter;

  beforeEach(() => {
    exporter = new CollectingExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000, // never auto-fires; we force-collect
    });
    provider = new MeterProvider({ readers: [reader] });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it("exports a delivery counter and a duration histogram to the collector", async () => {
    const meter = provider.getMeter("orbital-pulse-webhooks");
    const metrics = new OtelWebhookMetrics(meter);

    metrics.onDelivered(250, attrs);

    await provider.forceFlush();
    expect(exporter.batches.length).toBeGreaterThan(0);

    const byName = collectMetricNames(
      exporter.batches[exporter.batches.length - 1],
    );
    expect([...byName.keys()]).toEqual(
      expect.arrayContaining([
        "webhook.deliveries",
        "webhook.delivery.duration",
      ]),
    );

    // Histogram value should be in SECONDS (250ms -> 0.25s).
    const hist = byName.get("webhook.delivery.duration") as {
      dataPoints: { value: { sum: number; count: number } }[];
    };
    expect(hist.dataPoints[0].value.count).toBe(1);
    expect(hist.dataPoints[0].value.sum).toBeCloseTo(0.25, 5);
  });

  it("tags the deliveries counter with the outcome attribute", async () => {
    const meter = provider.getMeter("orbital-pulse-webhooks");
    const metrics = new OtelWebhookMetrics(meter);

    metrics.onDelivered(100, attrs);
    metrics.onFailed(attrs);
    metrics.onDropped(attrs);

    await provider.forceFlush();
    const byName = collectMetricNames(
      exporter.batches[exporter.batches.length - 1],
    );
    const counter = byName.get("webhook.deliveries") as {
      dataPoints: { attributes: Record<string, unknown>; value: number }[];
    };
    const outcomes = counter.dataPoints
      .map((d) => d.attributes.outcome)
      .sort();
    expect(outcomes).toEqual(["delivered", "dropped", "failed"]);
    // Each outcome recorded exactly once.
    for (const d of counter.dataPoints) {
      expect(d.value).toBe(1);
      expect(d.attributes.host).toBe("hooks.example.com");
      expect(d.attributes["event.type"]).toBe("payment.received");
    }
  });

  it("records retries on its own counter", async () => {
    const meter = provider.getMeter("orbital-pulse-webhooks");
    const metrics = new OtelWebhookMetrics(meter);

    metrics.onRetry(attrs);
    metrics.onRetry({ ...attrs, attempt: 2 });

    await provider.forceFlush();
    const byName = collectMetricNames(
      exporter.batches[exporter.batches.length - 1],
    );
    const retries = byName.get("webhook.retries") as {
      dataPoints: { value: number }[];
    };
    const total = retries.dataPoints.reduce((s, d) => s + d.value, 0);
    expect(total).toBe(2);
  });
});
