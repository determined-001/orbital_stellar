---
title: Webhooks
description: Register, secure, and handle webhook deliveries.
---

## Overview

Webhooks let your server receive instant HTTP notifications when a Stellar address sees activity. Orbital Stellar delivers signed `POST` requests to your endpoint with retries on failure.

## Registering a webhook

```typescript
// POST /webhooks/register
const res = await fetch('http://localhost:3000/webhooks/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: 'G...',       // Stellar address to watch
    url: 'https://...',    // Your endpoint URL
    secret: 'my-secret',  // Used to sign payloads
  }),
})
const registration = await res.json()
```

## Webhook payload

Every delivery contains a `NormalizedEvent` object:

```json
{
  "type": "payment.received",
  "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "amount": "100.0000000",
  "asset": "XLM",
  "timestamp": "2024-01-15T12:34:56Z",
  "raw": { ... }
}
```

## Verifying signatures

Every request includes `X-Orbital-Signature` and `X-Orbital-Timestamp` headers. The signature is computed as `HMAC(secret, timestamp + "." + rawBody)`.

```typescript
import { verifyWebhook } from '@orbital/pulse-webhooks'
import express from 'express'

const app = express()

// Use raw body parser — do NOT use express.json() for this route
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.headers['x-orbital-signature'] as string
  const timestamp = req.headers['x-orbital-timestamp'] as string
  const payload = req.body.toString('utf8')

  const event = verifyWebhook(payload, sig, process.env.WEBHOOK_SECRET!, timestamp)
  if (!event) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Handle the event...

  res.sendStatus(200)
})
```

> **Important:** Always verify signatures before processing events. This ensures the payload came from Orbital Stellar and has not been tampered with.

## Retry behavior

If your endpoint returns a non-2xx response or times out, Orbital Stellar retries the delivery with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 second |
| 3 | 2 seconds |

After 3 failures, a `webhook.failed` event is emitted internally. You can listen to this on the `WebhookDelivery` instance.

## Unregistering a webhook

```bash
curl -X DELETE http://localhost:3000/webhooks/{address}
```

Or via the API:

```typescript
await fetch(`http://localhost:3000/webhooks/${address}`, {
  method: 'DELETE',
})
```

## Listing registered webhooks

```typescript
const res = await fetch('http://localhost:3000/webhooks')
const webhooks = await res.json()
// [{ address, url, registeredAt }, ...]
```
