import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export type AttemptOutcome = "success" | "failure" | "dropped" | "retry" | "unknown";

export type PrometheusWebhookMetricsOptions = {
  /** Optional registry to use; if omitted a new one is created. */
  registry?: Registry;
  /** If true, collect default process metrics on the registry. Defaults to true. */
  collectDefaultMetrics?: boolean;
  /** Metric name prefix. Defaults to `orbital_`. */
  prefix?: string;
};

export class PrometheusWebhookMetrics {
  private registry: Registry;
  private attempts: Counter<string>;
  private duration: Histogram<string>;
  private prefix: string;

  constructor(opts: PrometheusWebhookMetricsOptions = {}) {
    this.registry = opts.registry ?? new Registry();
    this.prefix = opts.prefix ?? "orbital_";

    if (opts.collectDefaultMetrics ?? true) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.attempts = new Counter({
      name: `${this.prefix}webhook_attempts_total`,
      help: "Total webhook delivery attempts",
      labelNames: ["url", "outcome", "status"] as string[],
      registers: [this.registry],
    });

    this.duration = new Histogram({
      name: `${this.prefix}webhook_duration_seconds`,
      help: "Webhook delivery duration in seconds",
      labelNames: ["url", "status"] as string[],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  /** Returns the underlying Prometheus registry so it can be scraped or mounted. */
  register(): Registry {
    return this.registry;
  }

  /** Record a delivery attempt.
   * - `url` should be the target URL string (useful for cardinality-limited labels in production).
   * - `outcome` is one of `success|failure|dropped|retry`.
   * - `status` is the HTTP status code (or an error token) as a string.
   */
  recordAttempt(url?: string, outcome: AttemptOutcome = "unknown", status: string = "-") {
    this.attempts.inc({ url: url ?? "unknown", outcome, status }, 1);
  }

  /** Observe delivery duration in seconds. */
  recordDuration(seconds: number, url?: string, status: string = "-") {
    this.duration.observe({ url: url ?? "unknown", status }, seconds);
  }
}

export default PrometheusWebhookMetrics;
