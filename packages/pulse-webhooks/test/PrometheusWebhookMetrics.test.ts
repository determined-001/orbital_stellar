import { describe, it, expect } from "vitest";
import { PrometheusWebhookMetrics } from "../src/PrometheusWebhookMetrics";

describe("PrometheusWebhookMetrics", () => {
  it("registers metrics and exposes them via the registry", async () => {
    const m = new PrometheusWebhookMetrics({ collectDefaultMetrics: false });
    m.recordAttempt("https://example.com/hooks", "success", "200");
    m.recordDuration(0.125, "https://example.com/hooks", "200");

    const registry = m.register();
    const metricsText = await registry.metrics();

    expect(metricsText).toContain("orbital_webhook_attempts_total");
    expect(metricsText).toContain("orbital_webhook_duration_seconds");
  });
});
