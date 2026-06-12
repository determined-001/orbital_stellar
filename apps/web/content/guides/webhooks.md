---
title: Webhooks
description: Sign, deliver, and verify Stellar event webhooks with @orbital-stellar/pulse-webhooks.
---

## Overview

`@orbital-stellar/pulse-webhooks` is the "push" side of Orbital. Attach it to a `pulse-core` `Watcher` and every event becomes one or more outbound HTTPS POSTs with a verifiable HMAC-SHA256 signature, retry on failure, configurable timeout, and SSRF hardening.

This guide covers both sides: setting up delivery in your backend, and verifying signatures in the receiving service (Node or edge runtime).

## Sender side — `WebhookDelivery`

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

When `url` is an array, each endpoint is delivered to in parallel and retried independently.

### Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string \| string[]` | — | Destination endpoint(s). Must be HTTPS in production |
| `secret` | `string` | — | Shared secret used to sign payloads |
| `retries` | `number` | `3` | Retry attempts before emitting `webhook.failed` |
| `deliveryTimeoutMs` | `number` | `10_000` | Per-attempt abort threshold |
| `allowPrivateNetworks` | `boolean` | `false` | Bypass SSRF checks for local/private IPs (dev only) |

## Webhook payload

Every delivery is a JSON-serialized `NormalizedEvent`. For example, a payment:

```json
{
  "type": "payment.received",
  "to": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "from": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "amount": "100.0000000",
  "asset": "XLM",
  "timestamp": "2026-05-07T12:34:56Z",
  "raw": { "...": "original Horizon record" }
}
```

Other event types (`account.created`, `trustline.added`, `offer.updated`, etc.) carry their own payload shapes — `switch` on `event.type` to narrow per branch in TypeScript.

## Delivery contract

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-orbital-signature` | hex HMAC-SHA256 of `timestamp + "." + raw body` |
| `x-orbital-timestamp` | Unix epoch milliseconds as a string |
| `x-orbital-attempt` | `1`, `2`, … up to `retries` |

- **Success:** any 2xx response
- **Retry:** any non-2xx, network error, or timeout. Backoff is exponential: `2^(attempt-1) × 1000 ms`
- **Failure:** after `retries` failed attempts for a URL, the watcher emits `webhook.failed` with the original event in `raw.originalEvent` and the failed target in `raw.url`

## Receiver side — Node.js

Use `verifyWebhook` with raw-body middleware:

```ts
import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";
import express from "express";

const app = express();

// Use raw body parser — do NOT use express.json() for this route
app.post("/hooks/stellar", express.raw({ type: "application/json" }), (req, res) => {
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
  console.log(`Verified ${event.type}`);
  res.sendStatus(200);
});
```

> **Important:** Always verify signatures before processing events. `verifyWebhook` uses `crypto.timingSafeEqual` under the hood — do not roll your own comparison.

## Receiver side — Cloudflare Workers / Vercel Edge

Cloudflare Workers and Vercel Edge runtimes don't ship Node.js `crypto`. Use `verifyWebhookEdge`, which uses Web Crypto API and is async:

```js
import { verifyWebhookEdge } from "@orbital-stellar/pulse-webhooks";

export default {
  async fetch(request, env) {
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

    // Handle the verified event...
    return new Response("ok", { status: 200 });
  },
};
```

Same in Deno or any other Web-Crypto-supporting runtime — `verifyWebhookEdge` has no Node dependency.

## SSRF protection

`pulse-webhooks` blocks delivery to private network ranges by default to prevent SSRF (Server-Side Request Forgery):

- **Loopback** — `127.0.0.0/8`, `::1`
- **Private** — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- **Link-local** — `169.254.0.0/16`

DNS resolution is verified against the blocklist before delivery to defeat DNS rebinding attacks. To allow private networks for local development, set `allowPrivateNetworks: true` on the `WebhookDelivery` config — never enable this in production.

## Listening for delivery failures

After exhausting retries against a URL, `WebhookDelivery` emits a `webhook.failed` event on the watcher you can route to a dead-letter queue:

```ts
watcher.on("webhook.failed", (notification) => {
  console.error(
    `delivery failed for ${notification.raw.url}: ${notification.raw.error}`,
  );
  // Forward notification.raw.originalEvent to your DLQ
});
```

## Stopping delivery

`delivery.stop()` removes the delivery driver from the watcher. The underlying watcher continues running — call `engine.unsubscribe(address)` if you also want to tear down the subscription.
