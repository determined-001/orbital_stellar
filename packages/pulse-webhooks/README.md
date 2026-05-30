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
  console.log(`Verified payment: ${event.amount} ${event.asset}`);
  res.sendStatus(200);
});
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

### `verifyWebhook(payload, signature, secret, timestamp)` → `NormalizedEvent | null`

Verifies that `payload` was signed with `secret` using `timestamp + "." + payload`. Returns the parsed event on success, `null` on any failure (bad signature, malformed JSON, invalid timestamp, length mismatch).

Uses `crypto.timingSafeEqual` under the hood — do not roll your own comparison.

### `verifyWebhookEdge(payload, signature, secret, timestamp)` → `Promise<NormalizedEvent | null>`

Edge-compatible version of `verifyWebhook` using Web Crypto API. Works in Cloudflare Workers, Deno, and browsers. Returns a Promise that resolves to the parsed event on success, `null` on any failure.

Uses constant-time comparison and Web Crypto for HMAC-SHA256 verification.

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
