---
title: Quick Start
description: Subscribe to real-time Stellar events in five minutes.
---

This guide walks you through the three SDK packages with the smallest possible working example for each. Pick the one that matches what you're building.

## 1. Subscribe to events directly (`pulse-core`)

The fastest path. Install `pulse-core`, instantiate `EventEngine`, subscribe to an address, handle events.

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");

watcher.on("payment.received", (event) => {
  console.log(`+${event.amount} ${event.asset} from ${event.from}`);
});

watcher.on("payment.sent", (event) => {
  console.log(`-${event.amount} ${event.asset} to ${event.to}`);
});

// Listen to everything on this address
watcher.on("*", (event) => {
  console.log(`event ${event.type}`, event);
});
```

Run it on testnet, send a test payment to that address from the [Stellar Laboratory](https://laboratory.stellar.org), and you'll see the event print within a few seconds.

`engine.stop()` cleanly closes the upstream connection. Always call it in your shutdown path.

## 2. Add webhook delivery (`pulse-webhooks`)

Want to push events to an HTTPS endpoint with signed retries? Layer `WebhookDelivery` on top of a watcher:

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
  deliveryTimeoutMs: 10_000,
});
```

Verify on the receiver side:

```ts
import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";
import express from "express";

const app = express();

app.post("/hooks/stellar", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.header("x-orbital-signature");
  const timestamp = req.header("x-orbital-timestamp");
  if (!signature || !timestamp) return res.sendStatus(400);

  const event = verifyWebhook(req.body, signature, process.env.WEBHOOK_SECRET!, timestamp);
  if (!event) return res.sendStatus(401);

  console.log(`Verified ${event.type}: ${event.amount} ${event.asset}`);
  res.sendStatus(200);
});
```

Cloudflare Workers? Use `verifyWebhookEdge` instead — same arguments, returns a `Promise`. See the [webhooks guide](../guides/webhooks) for the full edge example.

## 3. Add React hooks (`pulse-notify`)

The React hooks open a browser `EventSource` connection to a backend that exposes Orbital events as SSE. You can stand that backend up yourself with `pulse-core` and a few lines of Express, or copy the Next.js route handler that powers the demo on this site (`apps/web/app/api/events/[address]/route.ts` in the repo).

```tsx
"use client";
import { useStellarPayment } from "@orbital-stellar/pulse-notify";

export function LiveBalance({ address }: { address: string }) {
  const { event, connected, error } = useStellarPayment(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
  );

  if (error) return <div className="text-red-500">{error}</div>;
  if (!connected) return <div>Connecting…</div>;
  if (!event) return <div>Listening for payments…</div>;

  return (
    <div>
      +{event.amount} {event.asset} from {event.from.slice(0, 8)}…
    </div>
  );
}
```

See the [real-time events guide](../guides/real-time-events) for the full hook surface, type narrowing, and how to stand up a minimal SSE backend with `pulse-core`.

## Next step

→ [Webhooks guide](../guides/webhooks) — fan-out, retry policy, SSRF hardening, edge-runtime verification.
→ [Real-time events guide](../guides/real-time-events) — React hooks, SSE plumbing, type narrowing.
