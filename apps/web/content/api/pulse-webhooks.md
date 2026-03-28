---
title: pulse-webhooks
description: HMAC-signed webhook delivery with automatic retry.
---

## Overview

`@orbital/pulse-webhooks` wraps a `Watcher` and delivers events to an HTTP endpoint. Each delivery is signed with HMAC-SHA256 so your server can verify authenticity.

## Installation

```bash
npm install @orbital/pulse-webhooks
```

## WebhookDelivery

### Constructor

```typescript
import { WebhookDelivery } from '@orbital/pulse-webhooks'

const delivery = new WebhookDelivery(watcher, {
  url: 'https://your-app.com/webhook',
  secret: 'my-signing-secret',
  retries: 3,               // optional, default: 3
  deliveryTimeoutMs: 10000, // optional, default: 10000
})
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | — | Endpoint to POST events to |
| `secret` | `string` | — | HMAC signing secret |
| `retries` | `number` | `3` | Max delivery attempts |
| `deliveryTimeoutMs` | `number` | `10000` | Per-attempt timeout in ms |

### Events

```typescript
delivery.on('webhook.failed', ({ event, error }) => {
  console.error(`Delivery failed after all retries: ${error.message}`)
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
const isValid = verifyWebhook(rawBody, signature, secret)
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `rawBody` | `Buffer \| string` | The raw request body |
| `signature` | `string` | Value of `X-Orbital-Signature` header |
| `secret` | `string` | The signing secret used at registration |

### Returns

`boolean` — `true` if the signature matches, `false` otherwise.

> Uses Node.js `crypto.timingSafeEqual` to prevent timing attacks.

## Delivery headers

Every webhook POST includes:

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Orbital-Signature` | HMAC-SHA256 hex digest of the body |
| `X-Orbital-Event` | Event type (e.g. `payment.received`) |
| `X-Orbital-Timestamp` | ISO 8601 delivery time |
