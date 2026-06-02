# @orbital/pulse-webhooks

**HMAC-signed webhook delivery for Stellar events.** Attach to a `pulse-core` watcher and every event becomes one or more outbound HTTPS POSTs with a verifiable signature, retry on failure, and configurable timeout.

```bash
pnpm add @orbital/pulse-webhooks @orbital/pulse-core
```

## What it does

`pulse-webhooks` is the "push" side of Orbital. It listens to a `Watcher`, serializes events to JSON, signs the payload with HMAC-SHA256, and POSTs to one or more endpoints. On transient failure it retries each URL independently with exponential backoff; on permanent failure it emits a `webhook.failed` event you can catch and route to a dead-letter queue.

Consumers verify the signature using the shared secret you provisioned — `verifyWebhook` is exported for that purpose.

## Quickstart — sender side

```ts
import { EventEngine } from "@orbital/pulse-core";
import { WebhookDelivery } from "@orbital/pulse-webhooks";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: [
    "https://your-app.com/hooks/stellar",
    "https://staging.your-app.com/hooks/stellar",
  ],
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
  deliveryTimeoutMs: 10_000,
});
```

## Quickstart — receiver side

```ts
import { verifyWebhook } from "@orbital/pulse-webhooks";
import express from "express";

const app = express();

app.post(
  "/hooks/stellar",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.header("x-orbital-signature");
    const timestamp = req.header("x-orbital-timestamp");
    if (!signature || !timestamp) return res.sendStatus(400);

    const event = verifyWebhook(
      req.body,
      signature,
      process.env.WEBHOOK_SECRET!,
      timestamp,
    );
    if (!event) return res.sendStatus(401);

    // event is a verified NormalizedEvent
    console.log(`Verified payment: ${event.amount} ${event.asset}`);
    res.sendStatus(200);
  },
);
```

## Verifying in Cloudflare Workers

Cloudflare Workers don't have Node.js crypto — they use Web Crypto API. Use `verifyWebhookEdge` for edge runtime compatibility:

```js
import { verifyWebhookEdge } from "@orbital/pulse-webhooks";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("x-orbital-signature");
    const timestamp = request.headers.get("x-orbital-timestamp");

    if (!signature || !timestamp) {
      return new Response("Missing headers", { status: 400 });
    }

    const payload = await request.text();
    const event = await verifyWebhookEdge(
      payload,
      signature,
      env.WEBHOOK_SECRET,
      timestamp,
    );

    if (!event) {
      return new Response("Invalid signature", { status: 401 });
    }

    // event is a verified NormalizedEvent
    console.log(`Verified payment: ${event.amount} ${event.asset}`);

    // Process the webhook...
    return new Response("Webhook processed", { status: 200 });
  },
};
```

**Key differences for Workers:**

- Use `verifyWebhookEdge` instead of `verifyWebhook`
- Function is async (returns Promise)
- Uses Web Crypto API instead of Node.js crypto
- Works in Cloudflare Workers, Deno, and browsers

## API

### `new WebhookDelivery(watcher, config)`

Attaches a delivery driver to a `Watcher`. Every event the watcher emits is delivered to each URL in `config.url`.

| Field                         | Type                 | Default  | Description                                                                           |
| ----------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------- |
| `config.url`                  | `string \| string[]` | —        | One destination endpoint or a fan-out list of endpoints. Must be HTTPS in production. |
| `config.secret`               | `string`             | —        | Shared secret used to sign payloads                                                   |
| `config.retries`              | `number`             | `3`      | Number of retry attempts before emitting `webhook.failed`                             |
| `config.deliveryTimeoutMs`    | `number`             | `10_000` | Abort threshold for each HTTP attempt                                                 |
| `config.allowPrivateNetworks` | `boolean`            | `false`  | If true, bypass SSRF checks for local/private IP ranges                               |

### `new RedisRetryQueue(client, options?)`

Provides a Redis-backed `RetryQueue` adapter without bundling a Redis client. Pass any client that implements the small `RedisLike` sorted-set surface: `zadd`, `zrangebyscore`, `zrevrange`, `zrem`, and `zcard`.

Records are stored in a sorted set keyed by `nextRetryAt`. The key convention is `<keyPrefix>:retry-queue:<queueName>` — defaults to `orbital:pulse-webhooks:retry-queue:default`.

### `verifyWebhook(payload, signature, secret, timestamp, options?)` → `NormalizedEvent | null`

Verifies that `payload` was signed with `secret` using `timestamp + "." + payload`. Returns the parsed event on success, `null` on any failure (bad signature, malformed JSON, invalid timestamp, length mismatch).
The optional `options.version` field is a negotiation hook for future signature header formats. `"v1"` (default) preserves current `x-orbital-signature` behavior; `"v2"` is a reserved placeholder for a future `x-orbital-signature-v2` implementation.
Uses `crypto.timingSafeEqual` under the hood — do not roll your own comparison.

**When to use:** Standard webhook verification when you need access to the event payload immediately.

### `verifyWebhookRaw(payload, signature, secret, timestamp)` → `boolean`

Verifies the signature of `payload` without parsing JSON. Returns `true` if the signature is valid, `false` otherwise.

Use this when routing the raw body to another consumer (e.g., a message queue) to avoid the JSON parse overhead.

```ts
const isValid = verifyWebhookRaw(rawPayload, signature, secret, timestamp);
if (isValid) {
  // Send raw payload to SQS, Kafka, etc. without parsing
  await queue.send(rawPayload);
} else {
  res.sendStatus(401);
}
```

**When to use:** When you're routing webhooks to a queue or other service and don't need to access the event data immediately.

### `verifyWebhookEdge(payload, signature, secret, timestamp, options?)` → `Promise<NormalizedEvent | null>`

Edge-compatible version of `verifyWebhook` using Web Crypto API. Works in Cloudflare Workers, Deno, and browsers. Returns a Promise that resolves to the parsed event on success, `null` on any failure.

The optional `options.version` field mirrors `verifyWebhook` — `"v1"` (default) is current behavior; `"v2"` is reserved.

Uses constant-time comparison and Web Crypto for HMAC-SHA256 verification.

### `verifyWebhookEdgeRaw(payload, signature, secret, timestamp)` → `Promise<boolean>`

Edge-compatible version of `verifyWebhookRaw` using Web Crypto API. Verifies the signature without parsing JSON. Returns `true` if the signature is valid, `false` otherwise.

Use this in edge runtimes when routing raw payloads to avoid JSON parse overhead.

```js
const isValid = await verifyWebhookEdgeRaw(
  rawPayload,
  signature,
  secret,
  timestamp,
);
if (isValid) {
  // Send raw payload to R2, KV, or other Cloudflare service
  await env.BUCKET.put(key, rawPayload);
} else {
  return new Response("Invalid signature", { status: 401 });
}
```

**When to use:** Edge runtime webhook verification with no immediate need for parsed event data.

## Delivery contract

- **Request method:** `POST`
- **Content-Type:** `application/json`
- **Body:** The full `NormalizedEvent`, JSON-serialized
- **Headers:**
  - `x-orbital-signature`: hex-encoded HMAC-SHA256 of `x-orbital-timestamp + "." + raw body`
  - `x-orbital-timestamp`: Unix epoch milliseconds as a string (for example: `1714176000000`)
  - `x-orbital-attempt`: `1`, `2`, … up to `retries`
- **Success:** Any 2xx response
- **Retry:** Any non-2xx, network error, or timeout. Backoff is exponential: `2^(attempt-1) × 1000 ms`.
- **Failure:** After `retries` unsuccessful attempts for a given URL, the watcher emits `webhook.failed` with the original event in `raw.originalEvent` and the failed target in `raw.url`.

## Dead Letter Queue (DLQ)

Failed webhooks are automatically tracked in a `DeadLetterStore`. Query failures by URL, time window, or limit.

```ts
import { DeadLetterStore, WebhookDelivery } from "@orbital/pulse-webhooks";

const dlq = new DeadLetterStore();

const delivery = new WebhookDelivery(watcher, config, dlq);

// Query all failures for a specific URL in a time window
const failures = dlq.list({
  url: "https://example.com/webhooks",
  since: Date.now() - 24 * 60 * 60 * 1000, // last 24h
  limit: 100,
});

failures.forEach((entry) => {
  console.log(`Failed at ${entry.timestamp}: ${entry.error}`);
  console.log(`Event:`, entry.event);
  console.log(`Attempts:`, entry.attempts);
});
```

### `new DeadLetterStore()`

Creates a new dead letter store for tracking failed webhook deliveries.

### `store.add(url, event, error, attempts)` → `string`

Adds a failed delivery record. Returns a unique `id` you can use to retrieve or remove the entry later.

### `store.list(filter)` → `DeadLetterEntry[]`

Queries the store with optional filters. Returns entries sorted by timestamp (oldest first).

| Filter field | Type     | Description                                     |
| ------------ | -------- | ----------------------------------------------- |
| `url`        | `string` | Exact URL match                                 |
| `since`      | `number` | Unix ms >= this value (inclusive)               |
| `until`      | `number` | Unix ms <= this value (inclusive)               |
| `limit`      | `number` | Return at most this many entries (oldest first) |

All filters are optional. Combine them to build operational queries:

```ts
// All failures for a specific URL
dlq.list({ url: "https://example.com/webhooks" });

// Failures in the last hour
dlq.list({ since: Date.now() - 60 * 60 * 1000 });

// Recent failures for a specific URL, limit to 50
dlq.list({
  url: "https://example.com/webhooks",
  since: Date.now() - 24 * 60 * 60 * 1000,
  limit: 50,
});
```

### `store.get(id)` → `DeadLetterEntry | undefined`

Retrieve a specific entry by ID.

### `store.remove(id)` → `boolean`

Remove an entry from the store. Returns `true` if removed, `false` if not found.

### `store.clear()`

Remove all entries from the store.

### `store.size()` → `number`

Get the total number of entries in the store.

## Index Requirements for Adapter Authors

If you persist the dead letter store to a database, create these indexes for query efficiency:

```sql
-- Primary: partition dead letter entries by URL for fast URL-first queries
CREATE INDEX dlq_url_idx ON dead_letter_store(url);

-- Secondary: partition by timestamp for time-window queries
CREATE INDEX dlq_timestamp_idx ON dead_letter_store(timestamp);

-- Composite: accelerate combined (URL, timestamp) queries
CREATE INDEX dlq_url_timestamp_idx ON dead_letter_store(url, timestamp);
```

### Query patterns and their indexes:

| Pattern                                | Recommended index(es)   |
| -------------------------------------- | ----------------------- |
| `list({ url })`                        | `dlq_url_idx`           |
| `list({ since })` or `list({ until })` | `dlq_timestamp_idx`     |
| `list({ url, since, until })`          | `dlq_url_timestamp_idx` |
| `list({ url, limit })`                 | `dlq_url_idx`           |
| `list({ since, until, limit })`        | `dlq_timestamp_idx`     |

**Note:** `limit` does not require an index; it just truncates the result set after filtering.

## Health Aggregation

Monitor delivery health for a webhook URL using per-URL failure metrics and success tracking.

### `deliveryHealth(url)` → `DeadLetterHealth`

Returns health metrics for a specific webhook URL.

```ts
import { deliveryHealth } from "@orbital/pulse-webhooks";

const health = deliveryHealth("https://example.com/webhooks");
console.log(health);
// {
//   healthy: true,
//   lastSuccess: 1714176000000,
//   lastFailure: 1714172800000,
//   failureRate: 0.02  // 2% failure rate
// }
```

**Health rule:** A URL is considered `healthy = true` when:

- Failure rate < 5% in the **last hour**, AND
- At least one successful delivery in the **last 15 minutes**

If no failures exist in the last hour, `failureRate` is 0 (all successes).

**Return fields:**
| Field | Type | Description |
|-------|------|-------------|
| `healthy` | `boolean` | Overall health status per the rule above |
| `lastSuccess` | `number \| undefined` | Unix ms timestamp of most recent successful delivery, if any |
| `lastFailure` | `number \| undefined` | Unix ms timestamp of most recent failed delivery in the last hour, if any |
| `failureRate` | `number` | Ratio of failures to total attempts in the last hour (0–1, e.g., 0.05 = 5%) |

**Use cases:**

- Health dashboards and status pages
- Alert routing (route alerts if `healthy = false`)
- Capacity planning (track which webhooks fail most often)

## Security

- **Verify every signature.** `verifyWebhook` uses constant-time comparison.
- **Treat the secret like a password.** Store it in a secrets manager, not a config file.
- **Enforce HTTPS.** `WebhookDelivery` rejects non-HTTPS URLs unless `allowPrivateNetworks` is set; enforce the same at any layer where users supply target URLs.
- **Bound the payload.** On the receiver side, cap body size with `express.raw({ type: "application/json", limit: "100kb" })` or equivalent.

## Network safety

`pulse-webhooks` protects against SSRF (Server-Side Request Forgery) by validating every delivery target.

- **Rejected ranges:** By default, deliveries to loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and link-local (`169.254.0.0/16`) addresses are blocked.
- **Rebinding defense:** DNS resolution is verified against the blocklist before delivery to prevent DNS rebinding attacks.
- **Configuration:** To allow deliveries to private or local networks (e.g. for development), set `allowPrivateNetworks: true` in the `WebhookDelivery` config.

## Current limitations

- **Retries live in-process.** Restarting the process loses pending retries. Persistent retry queues with pluggable adapters (Redis, Postgres, S3) ship in Phase 1 — see [`ROADMAP.md`](../../ROADMAP.md#wave-13--cursor-persistence-and-replay-primitives).
- **Exponential backoff is hard-coded.** Configurable strategies (linear, jittered, capped-at-N-hours) are tracked under [`webhooks`](https://github.com/determined-001/orbital_stellar/labels/webhooks).
- **No signature versioning.** The header format is fixed at `x-orbital-signature` (HMAC-SHA256 hex) — there is no `v1=…` prefix. If the algorithm needs to change, a future `x-orbital-signature-v2` header will be introduced alongside `v1` for a deprecation window.

## Related documents

- [`docs/ARCHITECTURE.md` § 6 Webhook delivery internals](../../docs/ARCHITECTURE.md#6-webhook-delivery-internals) — full delivery and verification design
- [`docs/COOKBOOK.md`](../../docs/COOKBOOK.md) — recipes 6–9 cover delivery, verification, fan-out, and dead-letter routing
- [`docs/open-source-policy.md`](../../docs/open-source-policy.md) — interface vs adapter boundary
- [`SECURITY.md`](../../SECURITY.md) — threat model, secret rotation runbook, best practices for consumers
- [`CHANGELOG.md`](../../CHANGELOG.md) — release notes

## License

MIT
