import { metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('hosted-api-registry');

// Request counters and histograms
export const requestCounter = meter.createCounter('registry_api_requests_total', {
  description: 'Total number of HTTP requests to the registry API',
});

export const requestLatencyHistogram = meter.createHistogram('registry_api_request_duration_seconds', {
  description: 'Latency histogram for registry API requests',
  unit: 's',
});

// Cache metrics
export const cacheHitCounter = meter.createCounter('registry_api_cache_hits_total', {
  description: 'Total cache hits',
});

export const cacheMissCounter = meter.createCounter('registry_api_cache_misses_total', {
  description: 'Total cache misses',
});

// Chain read & fallback metrics
export const chainReadCounter = meter.createCounter('registry_api_chain_reads_total', {
  description: 'Total read requests reaching the chain',
});

export const fallbackCounter = meter.createCounter('registry_api_fallbacks_total', {
  description: 'Total requests triggering fallback mechanism',
});

// Structured logging helper for fallbacks
export function logAndRecordFallback(specHash: string, reason: string, details?: Record<string, unknown>) {
  fallbackCounter.add(1, { reason });

  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'registry_fallback_triggered',
      timestamp: new Date().toISOString(),
      spec_hash: specHash,
      reason,
      ...details,
    })
  );
}

// Tracing span attribute helper
export function setSpecHashSpanAttribute(specHash: string) {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute('spec.hash', specHash);
  }
}