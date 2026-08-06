# Service Level Objectives (SLOs) - Hosted API

This document defines availability, latency, and freshness targets for hosted registry endpoints.

## 1. Availability Target
* **Objective:** 99.9% uptime over a rolling 30-day window.
* **Indicator (SLI):** Ratio of successful responses (`2xx` and `3xx`) against total requests served by `/v1/registry/*`.
* **Health Probe:** Continuously monitored via `/v1/registry/health`.

## 2. Latency Target (p95)
* **Objective:** 95% of requests served in under 200 milliseconds ($p95 < 200ms$).
* **Indicator (SLI):** Measured via `registry_api_request_duration_seconds` metric.

## 3. Freshness-in-Ledgers Target
* **Objective:** 99.0% of resolution requests return chain state synchronized within 2 ledger rounds ($< 30$ seconds).
* **Indicator (SLI):** Tracked using `registry_api_chain_reads_total` versus `registry_api_fallbacks_total`.