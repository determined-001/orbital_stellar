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
      { maxAgeMs: 5 * 60 * 1000 }, // reject signatures older than 5 minutes
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
      { maxAgeMs: 5 * 60 * 1000 }, // reject signatures older than 5 minutes
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
| `config.random`               | `() => number`       | `random` | Optional RNG for testing jitter. Defaults to `Math.random`.                           |

### `verifyWebhook(payload, signature, secret, timestamp, options?)` → `NormalizedEvent | null`

Verifies that `payload` was signed with `secret` using `timestamp + "." + payload`. Returns the parsed event on success, `null` on any failure (bad signature, malformed JSON, invalid timestamp, length mismatch, or signature outside the replay window).

Uses `crypto.timingSafeEqual` under the hood — do not roll your own comparison.

| Option        | Type     | Default   | Description                                                    |
| ------------- | -------- | --------- | -------------------------------------------------------------- |
| `maxAgeMs`    | `number` | `300_000` | Reject signatures older than this many milliseconds            |
| `clockSkewMs` | `number` | `30_000`  | Clock-skew allowance for sender/receiver time differences      |
| `nowMs`       | `number` | `Date.now()` | Override current time (useful in tests)                     |

### `verifyWebhookEdge(payload, signature, secret, timestamp, options?)` → `Promise<NormalizedEvent | null>`

Edge-compatible version of `verifyWebhook` using Web Crypto API. Works in Cloudflare Workers, Deno, and browsers. Returns a Promise that resolves to the parsed event on success, `null` on any failure (including signatures outside the replay window).

Uses constant-time comparison and Web Crypto for HMAC-SHA256 verification. Accepts the same `options` as `verifyWebhook` (`maxAgeMs`, `clockSkewMs`, `nowMs`).

### Failure events

When a delivery cannot be completed, the `Watcher` emits special events for routing and debugging.

#### `webhook.failed`

Emitted after all retry attempts are exhausted for a given URL. The event payload is a `NormalizedEvent` where the `raw` field is a `WebhookFailureRaw` object:

```ts
import type { WebhookFailureRaw } from "@orbital/pulse-webhooks";

watcher.on("webhook.failed", (event) => {
  const meta = event.raw as WebhookFailureRaw;
  console.error(`Delivery failed to ${meta.url}: ${meta.error}`);
  console.log(`Original event: ${meta.originalEvent.type}`);
});
```

#### `webhook.dropped`

Emitted when a pending retry is dropped because the `maxConcurrentRetries` cap has been reached. This happens before the retry is even attempted. The `raw` field is a `WebhookDroppedRaw` object:

```ts
import type { WebhookDroppedRaw } from "@orbital/pulse-webhooks";

watcher.on("webhook.dropped", (event) => {
  const meta = event.raw as WebhookDroppedRaw;
  console.warn(`Dropped event for ${meta.url} (retry cap of ${meta.maxConcurrentRetries} hit)`);
});
```

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

## Security guarantees

Orbital provides a hardened delivery pipeline for high-stakes financial events. This package enforces several tiers of defense-in-depth:

| Guarantee | Mechanism | Threat Mitigated |
| :--- | :--- | :--- |
| **Authenticity** | HMAC-SHA256 signature (`x-orbital-signature`) | Payload tampering |
| **Integrity** | `timestamp . payload` signing bubble | Replay attacks (when window-checked) |
| **Side-channel defense** | `crypto.timingSafeEqual` comparison | Timing attacks on signatures |
| **SSRF Protection** | RFC 1918 & loopback block-list | Internal network exfiltration |
| **DNS Rebinding defense** | Pre-delivery IP validation | Validation-time vs Request-time IP swaps |
| **Resource bounding** | `maxConcurrentRetries` + body-size caps | Memory exhaustion / DoS |

### Threat Model

For a full breakdown of adversaries, assets, and mitigations (including secret rotation runbooks and detection signals), see the [core repository SECURITY.md](../../SECURITY.md).

#### Replay window
`pulse-webhooks` includes a timestamp in every signature and enforces a configurable replay window in both `verifyWebhook` and `verifyWebhookEdge`. Pass `maxAgeMs` in the options argument to bound how old a signature can be before it is rejected. The default is `300_000` (5 minutes), matching the recommendation in `SECURITY.md`.

```ts
const event = verifyWebhook(payload, signature, secret, timestamp, {
  maxAgeMs: 5 * 60 * 1000, // 5 minutes — reject replayed signatures
});
```

Always pass `maxAgeMs` explicitly. A consumer that omits the option still receives the safe 5-minute default, but being explicit makes the intent clear and guards against future default changes.

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
