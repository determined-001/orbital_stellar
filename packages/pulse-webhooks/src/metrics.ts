/**
 * Provider-agnostic metrics surface for {@link WebhookDelivery}.
 *
 * `WebhookDelivery` calls into this interface at each terminal outcome of a
 * delivery attempt. The interface deliberately knows nothing about any metrics
 * backend — concrete adapters (OpenTelemetry, Prometheus, StatsD, …) translate
 * these calls into their own counters and histograms.
 *
 * All methods MUST be cheap and non-throwing: they run inline on the delivery
 * path. Adapters that talk to a remote collector should buffer/aggregate
 * locally (the OTel SDK already does this) rather than doing I/O per call.
 *
 * ## Attribute conventions
 *
 * Attributes are intentionally low-cardinality. The full target URL and the
 * event payload are **never** passed through, because (a) URLs can embed
 * secrets/tokens and (b) unbounded label values blow up a metrics backend's
 * cardinality. `host` carries only the URL host, not the path or query.
 *
 * See `docs/metrics.md` for the documented conventions.
 */
export interface WebhookMetrics {
  /**
   * A delivery attempt succeeded (HTTP 2xx).
   * @param durationMs Wall-clock time from attempt start to the successful
   *   response, in **milliseconds**. Adapters convert to their own unit.
   */
  onDelivered(durationMs: number, attrs: DeliveryAttributes): void;

  /**
   * A delivery permanently failed — all `retries` attempts for this URL were
   * exhausted. Mirrors the existing `webhook.failed` watcher event.
   */
  onFailed(attrs: DeliveryAttributes): void;

  /**
   * A pending retry was evicted because the concurrent-retry cap was hit.
   * Mirrors the existing `webhook.dropped` watcher event.
   */
  onDropped(attrs: DeliveryAttributes): void;

  /**
   * A retry was scheduled after a transient failure (i.e. an attempt failed
   * but more attempts remain).
   */
  onRetry(attrs: DeliveryAttributes): void;
}

/**
 * Low-cardinality attributes attached to every metric data point.
 *
 * Keep every field bounded. Do not add the full URL, the payload, account
 * addresses, or anything else unbounded — see the cardinality note above.
 */
export interface DeliveryAttributes {
  /** Host of the target URL only (never the full URL). E.g. `hooks.example.com`. */
  host: string;
  /** Normalized event type, e.g. `payment.received`. Bounded by the event union. */
  eventType: string;
  /** 1-based attempt number for this data point. */
  attempt: number;
}

/**
 * A `WebhookMetrics` that does nothing. Used as the default when no metrics
 * adapter is configured, so the delivery path never has to null-check.
 */
export const NoopWebhookMetrics: WebhookMetrics = {
  onDelivered() {},
  onFailed() {},
  onDropped() {},
  onRetry() {},
};

/**
 * Extract the bounded `host` attribute from a target URL. Falls back to
 * `"unknown"` for unparseable URLs so a metric is still recorded.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
