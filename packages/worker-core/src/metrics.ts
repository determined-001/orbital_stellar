/**
 * Cost-metering export surfaces (issue #1063, "21.2 Readiness cost metering").
 *
 * Acceptance criterion: *"Metrics exported through the existing Prometheus and
 * OTel surfaces."* Implementation note 1 says to reuse the metrics idiom in
 * `packages/pulse-webhooks` — one interface, a no-op default, one adapter per
 * backend — so that is exactly what this is, for {@link CostMeter}.
 *
 * Both adapters export the **attributed** cost, the even split that sums to
 * spend actually incurred, alongside the **standalone** cost. A dashboard that
 * only had the attributed number could not show what shared monitoring is
 * saving, and that gap is the shape of the curve the pricing decision needs.
 *
 * The OTel adapter takes a structurally-typed {@link Meter} rather than
 * importing `@opentelemetry/api`, matching `OtelWebhookMetrics`: a real OTel
 * `Meter` satisfies the type, and `worker-core` needs no hard dependency on it.
 */

import { Counter, Registry } from "prom-client";
import type { CostMeter } from "./backstop/costMeter.js";

export type MetricAttributes = Record<string, string | number | boolean>;

export type OtelCounter = {
  add(value: number, attributes?: MetricAttributes): void;
};

/**
 * Minimal structural subset of `@opentelemetry/api`'s `Meter`, mirroring
 * `pulse-webhooks`' own `Meter` type so the two packages share one idiom.
 */
export type Meter = {
  createCounter(name: string, options?: { description?: string }): OtelCounter;
};

/**
 * Prometheus-backed {@link CostMeter}.
 *
 * Exposes two metric families, both labelled by `subscription` and `driver`:
 * - `orbital_backstop_cost_attributed_total` — the even split; **sum this one.**
 * - `orbital_backstop_cost_standalone_total` — cost without sharing; never sum.
 *
 * `register()` returns the underlying `Registry` for scrape integration.
 *
 * @note `subscription` is a label value, so cardinality grows with the
 *       subscription count — the same caveat `PrometheusWebhookMetrics`
 *       carries for `url`. For a large deployment, aggregate by `driver` and
 *       keep per-subscription attribution in the meter itself.
 */
export class PrometheusCostMeter implements CostMeter {
  private readonly registry: Registry;
  private readonly attributedTotal: Counter<string>;
  private readonly standaloneTotal: Counter<string>;

  constructor(registry?: Registry) {
    this.registry = registry ?? new Registry();

    this.attributedTotal = new Counter({
      name: "orbital_backstop_cost_attributed_total",
      help: "Readiness cost attributed to a subscription (even split of shared cost)",
      labelNames: ["subscription", "driver"] as const,
      registers: [this.registry],
    });

    this.standaloneTotal = new Counter({
      name: "orbital_backstop_cost_standalone_total",
      help: "Readiness cost a subscription would incur with no shared monitoring",
      labelNames: ["subscription", "driver"] as const,
      registers: [this.registry],
    });
  }

  /** Returns the Prometheus Registry for scrape integration. */
  register(): Registry {
    return this.registry;
  }

  recordRpcCall(subscriptionIds: readonly string[], _method: string, durationMs: number): void {
    this.shared(subscriptionIds, [
      ["rpc_calls", 1],
      ["rpc_ms", durationMs],
    ]);
  }

  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void {
    this.shared(subscriptionIds, [
      ["export_scans", 1],
      ["export_scan_bytes", bytesScanned],
    ]);
  }

  recordCompute(subscriptionId: string, durationMs: number): void {
    this.direct(subscriptionId, "compute_ms", durationMs);
  }

  recordStorage(subscriptionId: string, bytes: number): void {
    this.direct(subscriptionId, "storage_byte_ledgers", bytes);
  }

  private shared(subscriptionIds: readonly string[], drivers: [string, number][]): void {
    const unique = [...new Set(subscriptionIds)];
    if (unique.length === 0) return;
    const share = 1 / unique.length;
    for (const subscription of unique) {
      for (const [driver, value] of drivers) {
        this.attributedTotal.inc({ subscription, driver }, value * share);
        this.standaloneTotal.inc({ subscription, driver }, value);
      }
    }
  }

  private direct(subscription: string, driver: string, value: number): void {
    this.attributedTotal.inc({ subscription, driver }, value);
    this.standaloneTotal.inc({ subscription, driver }, value);
  }
}

/**
 * OpenTelemetry-backed {@link CostMeter}: the attribute-based equivalent of
 * {@link PrometheusCostMeter}'s label-based families.
 *
 * - `orbital.backstop.cost.attributed` (counter, attributes: `subscription`, `driver`)
 * - `orbital.backstop.cost.standalone` (counter, attributes: `subscription`, `driver`)
 *
 * Construct with a real `Meter` from `metrics.getMeter("orbital-worker-core")`,
 * or any object exposing the same shape.
 */
export class OtelCostMeter implements CostMeter {
  private readonly attributed: OtelCounter;
  private readonly standalone: OtelCounter;

  constructor(meter: Meter) {
    this.attributed = meter.createCounter("orbital.backstop.cost.attributed", {
      description: "Readiness cost attributed to a subscription (even split of shared cost)",
    });
    this.standalone = meter.createCounter("orbital.backstop.cost.standalone", {
      description: "Readiness cost a subscription would incur with no shared monitoring",
    });
  }

  recordRpcCall(subscriptionIds: readonly string[], _method: string, durationMs: number): void {
    this.shared(subscriptionIds, [
      ["rpc_calls", 1],
      ["rpc_ms", durationMs],
    ]);
  }

  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void {
    this.shared(subscriptionIds, [
      ["export_scans", 1],
      ["export_scan_bytes", bytesScanned],
    ]);
  }

  recordCompute(subscriptionId: string, durationMs: number): void {
    this.direct(subscriptionId, "compute_ms", durationMs);
  }

  recordStorage(subscriptionId: string, bytes: number): void {
    this.direct(subscriptionId, "storage_byte_ledgers", bytes);
  }

  private shared(subscriptionIds: readonly string[], drivers: [string, number][]): void {
    const unique = [...new Set(subscriptionIds)];
    if (unique.length === 0) return;
    const share = 1 / unique.length;
    for (const subscription of unique) {
      for (const [driver, value] of drivers) {
        this.attributed.add(value * share, { subscription, driver });
        this.standalone.add(value, { subscription, driver });
      }
    }
  }

  private direct(subscription: string, driver: string, value: number): void {
    this.attributed.add(value, { subscription, driver });
    this.standalone.add(value, { subscription, driver });
  }
}

/**
 * Forwards every record to several meters.
 *
 * The expected deployment is exactly this: an {@link InMemoryCostMeter} to
 * answer marginal-cost questions plus an exporter to feed the dashboard. Making
 * that a composition rather than a feature of each adapter keeps the adapters
 * dumb.
 */
export class CompositeCostMeter implements CostMeter {
  private readonly meters: readonly CostMeter[];

  constructor(...meters: CostMeter[]) {
    this.meters = meters;
  }

  recordRpcCall(subscriptionIds: readonly string[], method: string, durationMs: number): void {
    for (const m of this.meters) m.recordRpcCall(subscriptionIds, method, durationMs);
  }

  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void {
    for (const m of this.meters) m.recordExportScan(subscriptionIds, bytesScanned);
  }

  recordCompute(subscriptionId: string, durationMs: number): void {
    for (const m of this.meters) m.recordCompute(subscriptionId, durationMs);
  }

  recordStorage(subscriptionId: string, bytes: number): void {
    for (const m of this.meters) m.recordStorage(subscriptionId, bytes);
  }
}
