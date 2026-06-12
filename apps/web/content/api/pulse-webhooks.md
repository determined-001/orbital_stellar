---
title: pulse-webhooks
description: HMAC-signed webhook delivery with automatic retry, Node + edge verification.
---

## Overview

`@orbital-stellar/pulse-webhooks` wraps a `pulse-core` `Watcher` and delivers events to one or more HTTPS endpoints. Each delivery is signed with HMAC-SHA256 so your server can verify authenticity. On transient failure each URL is retried independently with exponential backoff; on permanent failure a `webhook.failed` event is emitted.

Two verifiers are exported for the receiver side: `verifyWebhook` (Node.js `crypto`) and `verifyWebhookEdge` (Web Crypto API — works in Cloudflare Workers, Vercel Edge, Deno, and browsers).

## Installation

```bash
pnpm add @orbital-stellar/pulse-webhooks @orbital-stellar/pulse-core
```

## WebhookDelivery

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";

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

### Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string \| string[]` | — | Destination endpoint(s). Must be HTTPS in production |
| `secret` | `string` | — | Shared secret used to sign payloads |
| `retries` | `number` | `3` | Retry attempts before emitting `webhook.failed` |
| `deliveryTimeoutMs` | `number` | `10_000` | Per-attempt abort threshold |
| `allowPrivateNetworks` | `boolean` | `false` | Bypass SSRF checks (development only) |

When `url` is an array, each endpoint is delivered in parallel and retried independently.

### Stopping

```ts
delivery.stop(); // Detaches from the watcher; the watcher itself continues
```

To also stop the underlying subscription, call `engine.unsubscribe(address)`.

## verifyWebhook (Node.js)

```ts
import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";

// req.body must be the raw Buffer (use express.raw() middleware)
const event = verifyWebhook(
  rawBody,                 // string | Buffer
  signature,               // header: x-orbital-signature
  process.env.WEBHOOK_SECRET!,
  timestamp,               // header: x-orbital-timestamp
);
```

Returns the parsed `NormalizedEvent` on success, `null` on any failure (bad signature, malformed JSON, length mismatch).

Uses `crypto.timingSafeEqual` under the hood — never roll your own HMAC comparison.

## verifyWebhookEdge (Cloudflare Workers / Vercel Edge / Deno / browsers)

```ts
import { verifyWebhookEdge } from "@orbital-stellar/pulse-webhooks";

const event = await verifyWebhookEdge(
  payload,                 // string
  signature,
  env.WEBHOOK_SECRET,
  timestamp,
);
```

Async — returns a `Promise<NormalizedEvent | null>`. Uses Web Crypto API (`crypto.subtle`) for HMAC-SHA256 and constant-time comparison. No Node.js dependency.

**Key differences from `verifyWebhook`:**

- Async (returns `Promise`)
- Uses Web Crypto API instead of Node `crypto`
- Works in any runtime that supports `crypto.subtle`

## Delivery contract

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-orbital-signature` | hex HMAC-SHA256 of `timestamp + "." + raw body` |
| `x-orbital-timestamp` | Unix epoch milliseconds as a string |
| `x-orbital-attempt` | `1`, `2`, … up to `retries` |

- **Success:** any 2xx response
- **Retry:** any non-2xx, network error, or timeout. Backoff: `2^(attempt-1) × 1000 ms`
- **Failure:** after `retries` attempts, `webhook.failed` is emitted with `raw.originalEvent` and `raw.url`

## SSRF protection

By default, deliveries to private network ranges are blocked:

- Loopback: `127.0.0.0/8`, `::1`
- Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local: `169.254.0.0/16`

DNS resolution is checked against the blocklist before delivery to defeat DNS rebinding. Set `allowPrivateNetworks: true` to bypass — never in production.

## License

MIT
