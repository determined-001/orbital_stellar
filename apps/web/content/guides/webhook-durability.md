# Durable Webhook Delivery Guide

This guide explains how to achieve durable webhook delivery using the **RetryQueue** and **DeadLetterStore** abstractions provided by M4. It covers the available implementations, inspection and replay workflows, and what happens when a process restarts.

---

## Overview

- **`RetryQueue`** – Interface for enqueuing webhook delivery attempts that should be retried later.
- **`DeadLetterStore`** – Interface for persisting permanently failed webhook deliveries (the dead‑letter queue, DLQ).

Both interfaces enable reliable, durable delivery irrespective of process crashes or restarts.

---

## Implementations

| Interface | Implementation | Storage Backend | Typical Use‑Case |
|-----------|----------------|----------------|-----------------|
| `RetryQueue` | `RedisRetryQueue` | Redis (list + sorted set) | Low‑latency, in‑memory retry with persistence via Redis AOF/RDB |
| `RetryQueue` | `SqsRetryQueue` | AWS SQS (standard queue) | Cloud‑native, highly‑available retry with built‑in dead‑letter support |
| `DeadLetterStore` | `RedisDeadLetterStore` | Redis hash | Simple DLQ for development / self‑hosted environments |
| `DeadLetterStore` | `SqsDeadLetterStore` | AWS SQS (DLQ) | Production‑grade DLQ with visibility timeout & redrive policy |

---

## Workflow

1. **Send Webhook** – Application attempts to POST to the target URL.
2. **Success** – If the request returns `2xx`, the job is considered complete.
3. **Transient Failure** – Non‑2xx response or network error → enqueue a **retry** in the `RetryQueue`.
4. **Retry Processor** – Background worker polls the queue, re‑attempts delivery, and respects exponential back‑off.
5. **Exhausted Retries** – After the maximum retry count, the payload moves to the `DeadLetterStore`.
6. **DLQ Inspection** – Use the **DLQ CLI** (`dlq-cli`) or custom UI to list, filter, and view failed payloads.
7. **Replay** – Select one or more dead‑letter entries and push them back onto the `RetryQueue` for re‑processing.

---

## DLQ Inspection & Replay (Redis Example)

```bash
# List dead‑letter entries (Redis hash key: dlq:store)
redis-cli HKEYS dlq:store

# View a specific entry by its ID
redis-cli HGET dlq:store <entry-id>

# Replay an entry (push back to the retry queue)
redis-cli RPUSH retry:queue <payload-json>
```

The same concepts apply to SQS; replace the `redis-cli` commands with `aws sqs receive-message`, `aws sqs send-message`, etc.

---

## What Happens on Process Restart?

| Scenario | In‑Process Retry (no durable queue) | **Durable Retry (`RetryQueue`)** |
|----------|--------------------------------------|-----------------------------------|
| Process crashes before a retry is attempted | All pending retries are lost → webhook may never be delivered. | Pending retries are persisted in Redis/SQS. On restart the worker resumes processing from the stored queue. |
| Process restarts while retries are in‑flight | In‑flight attempts may be duplicated or abandoned. | Each retry entry records a **next‑attempt timestamp**; duplicate attempts are avoided by idempotent payload handling. |
| Max‑retry limit reached before restart | Failure handling is implementation‑specific; often ends in silent loss. | Payload automatically moves to `DeadLetterStore`, guaranteeing visibility for manual inspection and replay. |

---

## TL;DR

- Use **`RedisRetryQueue`** for local/dev environments and **`SqsRetryQueue`** for production cloud deployments.
- Leverage **`DeadLetterStore`** to capture permanently failed deliveries.
- The provided **DLQ CLI** (`dlq-cli`) enables inspection and replay without writing custom code.
- Durable queues ensure no webhook is lost across restarts.

---

## Further Reading

- [M4 RetryQueue Interface Documentation](../reference/retryqueue.md)
- [M4 DeadLetterStore Interface Documentation](../reference/deadletterstore.md)
- [DLQ CLI – Inspection & Replay](../cli/dlq-cli.md)
