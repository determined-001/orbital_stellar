---
title: pulse-webhooks
description: HMAC-signed webhook delivery with automatic retry.
---

## Overview

`@orbital/pulse-webhooks` wraps a `Watcher` and delivers events to one or more HTTP endpoints. Each delivery is signed with HMAC-SHA256 so your server can verify authenticity.

## Installation

```bash
npm install @orbital/pulse-webhooks
```

## WebhookDelivery

### Constructor

```typescript
import { WebhookDelivery } from '@orbital/pulse-webhooks'

const delivery = new WebhookDelivery(watcher, {
  url: [
    'https://your-app.com/webhook',
    'https://staging.your-app.com/webhook',
  ],
  secret: 'my-signing-secret',
  retries: 3,               // optional, default: 3
  deliveryTimeoutMs: 10000, // optional, default: 10000
})
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string \| string[]` | — | Endpoint to POST events to, or a list of endpoints for fan-out |
| `secret` | `string` | — | HMAC signing secret |
| `retries` | `number` | `3` | Max delivery attempts |
| `deliveryTimeoutMs` | `number` | `10000` | Per-attempt timeout in ms |

### Events

```typescript
watcher.on('webhook.failed', (event) => {
  console.error(`Delivery failed for ${event.raw.url}: ${event.raw.error}`)
})
```

### Stopping

```typescript
delivery.stop() // Also stops the underlying Watcher
```

## verifyWebhook

A standalone utility for verifying incoming webhook requests on your server.

```typescript
import { verifyWebhook } from '@orbital/pulse-webhooks'

// req.body must be the raw Buffer (use express.raw() middleware)
const event = verifyWebhook(
  rawBody.toString('utf8'),
  signature,
  secret,
  timestamp
)
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `payload` | `string` | The raw request body as a UTF-8 string |
| `signature` | `string` | Value of `X-Orbital-Signature` header |
| `secret` | `string` | The signing secret used at registration |
| `timestamp` | `string` | Value of `X-Orbital-Timestamp` header (Unix epoch milliseconds) |

### Returns

`NormalizedEvent \| null` — Parsed event when verification succeeds, `null` otherwise.

> Uses Node.js `crypto.timingSafeEqual` to prevent timing attacks.

## Delivery headers

Every webhook POST includes:

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Orbital-Signature` | HMAC-SHA256 hex digest of `X-Orbital-Timestamp + "." + raw body` |
| `X-Orbital-Timestamp` | Unix epoch milliseconds as a string |

When `url` is an array, each URL is delivered in parallel and retried independently.
