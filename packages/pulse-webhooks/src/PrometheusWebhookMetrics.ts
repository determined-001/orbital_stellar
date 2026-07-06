import { Counter, Histogram, Registry } from "prom-client";
import type { WebhookAttemptStatus, WebhookMetrics, WebhookTerminalOutcome } from "./types.js";

/**
 * Prometheus-backed implementation of the `WebhookMetrics` interface.
 *
 * Exposes three metric families:
 * - `orbital_webhook_attempts_total` (counter, labels: `url`, `status`)
 * - `orbital_webhook_duration_seconds` (histogram, labels: `url`, `status`)
 * - `orbital_webhook_terminal_outcomes_total` (counter, labels: `url`, `outcome`)
 *
 * Call `register()` to obtain the underlying `Registry` for scrape endpoint integration.
 *
 * @note URLs are used as label values, which can cause high cardinality in Prometheus.
 *       Consider normalising URLs (e.g. stripping query params) before passing them
 *       if you control the caller, or pre-aggregate upstream.
 */
export class PrometheusWebhookMetrics implements WebhookMetrics {
  private readonly registry: Registry;
  private readonly attemptsTotal: Counter<string>;
  private readonly durationSeconds: Histogram<string>;
  private readonly terminalOutcomesTotal: Counter<string>;

  /**
   * @param registry Optional shared Registry. When omitted a new one is created.
   */
  constructor(registry?: Registry) {
    this.registry = registry ?? new Registry();

    this.attemptsTotal = new Counter({
      name: "orbital_webhook_attempts_total",
      help: "Total number of webhook delivery attempts",
      labelNames: ["url", "status"] as const,
      registers: [this.registry],
    });

    this.durationSeconds = new Histogram({
      name: "orbital_webhook_duration_seconds",
      help: "Duration of webhook delivery attempts in seconds",
      labelNames: ["url", "status"] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.terminalOutcomesTotal = new Counter({
      name: "orbital_webhook_terminal_outcomes_total",
      help: "Total number of terminal webhook delivery outcomes",
      labelNames: ["url", "outcome"] as const,
      registers: [this.registry],
    });
  }

  /** Returns the Prometheus Registry for scrape integration. */
  register(): Registry {
    return this.registry;
  }

  recordAttempt(
    url: string,
    _attempt: number,
    durationMs: number,
    status: WebhookAttemptStatus,
  ): void {
    this.attemptsTotal.labels(url, status).inc();
    this.durationSeconds.labels(url, status).observe(durationMs / 1000);
  }

  recordTerminal(url: string, outcome: WebhookTerminalOutcome): void {
    this.terminalOutcomesTotal.labels(url, outcome).inc();
  }
}
