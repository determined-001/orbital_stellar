import http from "node:http";
import { PrometheusWebhookMetrics } from "../src/PrometheusWebhookMetrics";

const metrics = new PrometheusWebhookMetrics({ collectDefaultMetrics: true });
const registry = metrics.register();

// Simulate some activity
setInterval(() => {
  metrics.recordAttempt("https://example.com/hooks", "success", "200");
  metrics.recordDuration(Math.random() * 0.5, "https://example.com/hooks", "200");
}, 1500);

const server = http.createServer(async (req, res) => {
  if (!req) return;
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", registry.contentType || "text/plain; version=0.0.4");
    res.write(await registry.metrics());
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Prometheus metrics example. Visit /metrics to scrape.\n");
});

const port = process.env.PORT ? Number(process.env.PORT) : 9464;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Metrics server listening on http://localhost:${port}/metrics`);
});
