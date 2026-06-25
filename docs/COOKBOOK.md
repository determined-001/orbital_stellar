# Orbital — Cookbook

> Copy-paste recipes. Each one is the smallest working snippet that
> demonstrates one capability. For narrative walkthroughs (full setups,
> deployment, hardening) see the guides at
> [`apps/web/content/guides/`](../apps/web/content/guides/).
>
> **Legend.** ✅ ships in `v0.1.0` and runs against testnet/mainnet today.
> 🛠️ ships in Phase 1 (`v1.0`, Q2–Q3 2026).

---

## Table of contents

1. [Watch an account for incoming payments](#1-watch-an-account-for-incoming-payments)
2. [Subscribe to multiple addresses with one engine](#2-subscribe-to-multiple-addresses-with-one-engine)
3. [Filter events with a predicate](#3-filter-events-with-a-predicate)
4. [Handle reconnection and rate-limit notifications](#4-handle-reconnection-and-rate-limit-notifications)
5. [Use a custom Horizon URL](#5-use-a-custom-horizon-url)
6. [Deliver events to an HTTPS endpoint](#6-deliver-events-to-an-https-endpoint)
7. [Verify a webhook in a Cloudflare Worker](#7-verify-a-webhook-in-a-cloudflare-worker)
8. [Fan out one event to multiple URLs](#8-fan-out-one-event-to-multiple-urls)
9. [Route `webhook.failed` to a dead-letter queue](#9-route-webhookfailed-to-a-dead-letter-queue)
10. [Render live payments in React with type narrowing](#10-render-live-payments-in-react-with-type-narrowing)
11. [Stand up an SSE endpoint in Next.js](#11-stand-up-an-sse-endpoint-in-nextjs)
12. [Subscribe to Soroban contract events 🛠️](#12-subscribe-to-soroban-contract-events-)
13. [Unit test webhooks with deterministic jitter](#13-unit-test-webhooks-with-deterministic-jitter)

---

## 1. Watch an account for incoming payments

The shortest path. Subscribe, attach a handler, wait for events. ✅

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...YOUR_ACCOUNT");

watcher.on("payment.received", (event) => {
  console.log(`+${event.amount} ${event.asset} from ${event.from}`);
});
```

Send a test payment from the [Stellar Laboratory](https://laboratory.stellar.org) and the event prints within seconds. `engine.stop()` cleanly closes the upstream connection — always call it in your shutdown path.

---

## 2. Subscribe to multiple addresses with one engine

One Horizon connection, many watchers. The engine fans events out internally — no extra network cost per subscriber. ✅

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const accounts = ["GABC...", "GDEF...", "GHIJ..."];

for (const address of accounts) {
  const watcher = engine.subscribe(address);
  watcher.on("*", (event) => {
    console.log(`[${address.slice(0, 8)}] ${event.type}`);
  });
}
```

`engine.subscribe()` is idempotent — calling it twice for the same address returns the same `Watcher`. To stop watching one account without tearing down the stream: `engine.unsubscribe(address)`. To stop watching everything: `engine.unsubscribeAll()`.

---

## 3. Filter events with a predicate

Pass a `filter` function on `subscribe()` to suppress events you don't want delivered. The filter runs before any `on(…)` handler fires. ✅

```ts
import { EventEngine, type NormalizedEvent } from "@orbital/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...", {
  filter: (event: NormalizedEvent) =>
    event.type === "payment.received" &&
    Number(event.amount) >= 100, // ≥ 100 units, whatever the asset
});

watcher.on("payment.received", (event) => {
  console.log(`Large payment: ${event.amount} ${event.asset}`);
});
```

A predicate that throws is treated as `false` (suppress, with a warn log) — the engine never crashes on a bad filter.

---

## 4. Handle reconnection and rate-limit notifications

Lifecycle notifications surface alongside operation events on every watcher. Surface them as toasts, banners, or structured logs. ✅

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

watcher.on("engine.reconnecting", (n) => {
  console.warn(`Reconnect attempt ${n.attempt}, delay ${n.delayMs}ms`);
});

watcher.on("engine.rate_limited", (n) => {
  console.warn(`Horizon rate-limited us. Backing off ${n.delayMs}ms`);
});

watcher.on("engine.reconnected", (n) => {
  console.info(`Stream restored on attempt ${n.attempt}`);
});

watcher.on("engine.stopped", () => {
  console.info("Engine stopped");
});
```

The engine parses `Retry-After` headers on 429 responses and uses that exact delay (falling back to 60 s if the header is missing).

---

## 5. Use a custom Horizon URL

Self-hosted node, regional mirror, or futurenet. The `network` field still picks the chain context; `horizonUrl` overrides the HTTP target. ✅

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({
  network: "mainnet",
  horizonUrl: "https://horizon.your-node.example.com",
  reconnect: { initialDelayMs: 2000, maxDelayMs: 60_000 },
});

engine.start();
```

The URL must be `http://` or `https://`. The engine validates the URL at construction time and throws synchronously if it's malformed — you get a fast error, not a silent SSE failure.

---

## 6. Deliver events to an HTTPS endpoint

`WebhookDelivery` attaches to a watcher and POSTs every event to your endpoint with HMAC-SHA256 signing, exponential backoff retry, and a configurable per-attempt timeout. ✅

**Sender side** — attach delivery to the watcher:

```ts
import { EventEngine } from "@orbital/pulse-core";
import { WebhookDelivery } from "@orbital/pulse-webhooks";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
  deliveryTimeoutMs: 10_000,
});
```

**Receiver side** — verify the signature and enforce the replay window with `maxAgeMs`:

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
      req.body.toString(),
      signature,
      process.env.WEBHOOK_SECRET!,
      timestamp,
      { maxAgeMs: 5 * 60 * 1000 }, // reject signatures older than 5 minutes
    );
    if (!event) return res.sendStatus(401);

    console.log(`Verified ${event.type}`);
    res.sendStatus(200);
  },
);
```

Each request carries `x-orbital-signature` (hex HMAC-SHA256 over `${timestamp}.${body}`), `x-orbital-timestamp`, and `x-orbital-attempt`. Always pass `maxAgeMs` to bound replay — a signature without a replay window is valid indefinitely. The default is `300_000` (5 minutes), matching the recommendation in `SECURITY.md`.

---

## 7. Verify a webhook in a Cloudflare Worker

`verifyWebhookEdge` uses Web Crypto, so it runs on Cloudflare Workers, Vercel Edge, Deno, and browsers — anywhere without Node's `crypto` module. ✅

```ts
import { verifyWebhookEdge } from "@orbital/pulse-webhooks";

export default {
  async fetch(request: Request, env: { WEBHOOK_SECRET: string }) {
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
    if (!event) return new Response("Invalid signature", { status: 401 });

    // event is a verified, typed NormalizedEvent
    console.log(`Verified ${event.type}`);
    return new Response("ok");
  },
};
```

The verifier returns `null` on any failure (bad signature, malformed timestamp, bad JSON) — fail closed, never assume success.

---

## 8. Fan out one event to multiple URLs

`WebhookDelivery.config.url` accepts an array. Each URL retries independently — one slow endpoint does not block delivery to the others. ✅

```ts
new WebhookDelivery(watcher, {
  url: [
    "https://primary.your-app.com/hooks/stellar",
    "https://staging.your-app.com/hooks/stellar",
    "https://analytics.your-app.com/hooks/stellar",
  ],
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
});
```

The `webhook.failed` event (see recipe 9) fires per-URL, so you can detect which endpoint is sick and route accordingly.

---

## 9. Route `webhook.failed` to a dead-letter queue

When a delivery exhausts its retries, the watcher emits `webhook.failed` with the original event in `raw.originalEvent` and the failed URL in `raw.url`. Catch it and persist to a DLQ. ✅

```ts
import { EventEngine, type NormalizedEvent } from "@orbital/pulse-core";
import { WebhookDelivery, type WebhookFailureRaw } from "@orbital/pulse-webhooks";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://flaky.your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
});

watcher.on("webhook.failed", async (event) => {
  const { url, error, attempts, originalEvent } = event.raw as WebhookFailureRaw;
  await persistToDLQ({
    url,
    error,
    attempts,
    event: originalEvent,
    failedAt: new Date().toISOString(),
  });
});

declare function persistToDLQ(record: unknown): Promise<void>;
```

`webhook.dropped` fires when the concurrent-retry cap evicts a pending retry — handle it the same way if you care about every miss.

---

## 10. Render live payments in React with type narrowing

`useStellarEvent<T>` is generic — pass a narrow union as `T` to get full autocomplete and exhaustive `switch` checking. ✅

```tsx
"use client";
import { useStellarEvent } from "@orbital/pulse-notify";
import type { NormalizedEvent } from "@orbital/pulse-core";

type WalletEvents = Extract<
  NormalizedEvent,
  { type: "payment.received" | "payment.sent" | "trustline.added" }
>;

export function Wallet({ address }: { address: string }) {
  const { event, connected, error } = useStellarEvent<WalletEvents>(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
    { event: ["payment.received", "payment.sent", "trustline.added"] },
  );

  if (error) return <p className="text-red-500">{error}</p>;
  if (!connected) return <p>Connecting…</p>;
  if (!event) return <p>Listening…</p>;

  switch (event.type) {
    case "payment.received":
      return <p>+{event.amount} {event.asset} from {event.from.slice(0, 8)}…</p>;
    case "payment.sent":
      return <p>−{event.amount} {event.asset} to {event.to.slice(0, 8)}…</p>;
    case "trustline.added":
      return <p>Added trustline for {event.asset}</p>;
  }
}
```

A `switch` over `event.type` with no `default` clause will produce a TypeScript error if you ever miss a case — the narrow union does the work.

---

## 11. Stand up an SSE endpoint in Next.js

The hooks expect a backend that re-emits Orbital events as Server-Sent Events. The marketing site ships a working reference at `apps/web/app/api/events/[address]/route.ts` — copy it, strip the demo limits in `apps/web/lib/demo-limits.ts`, and you have your production SSE handler. ✅

```ts
// app/api/events/[address]/route.ts
import { EventEngine } from "@orbital/pulse-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const g = globalThis as unknown as { __engine?: EventEngine };
function engine() {
  if (!g.__engine) {
    g.__engine = new EventEngine({ network: "mainnet" });
    g.__engine.start();
  }
  return g.__engine;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const watcher = engine().subscribe(address);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const beat = setInterval(
        () => controller.enqueue(encoder.encode(`: heartbeat\n\n`)),
        30_000,
      );
      watcher.on("*", send);
      req.signal.addEventListener("abort", () => {
        clearInterval(beat);
        watcher.removeListener("*", send);
        engine().unsubscribe(address);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

The `globalThis` trick keeps one `EventEngine` alive across Next.js HMR. In production (`next start`) it persists for the lifetime of the Node process. On Vercel serverless, expect periodic reconnects when the function instance recycles — fine for demos, not for production Cloud.

---

## 12. Subscribe to Soroban contract events 🛠️

Phase 1, lands in `v1.0`. Subscribes to smart-contract events by contract ID and topic filter via Stellar RPC. Same normalized-event taxonomy as classic operations, with two new types: `contract.invoked` and `contract.emitted`.

```ts
// 🛠️ Planned API — Phase 1 (Q2–Q3 2026)
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({
  network: "mainnet",
  soroban: {
    rpcUrl: "https://soroban-rpc.your-node.example.com",
  },
});
engine.start();

const watcher = engine.subscribeContract({
  contractId: "CA...",
  topics: ["transfer"], // optional topic filter
});

watcher.on("contract.emitted", (event) => {
  console.log(event.contractId, event.topic, event.decodedData);
});
```

Decoding to typed `decodedData` requires the ABI Registry client (also Phase 1). Until then, raw XDR is exposed in `event.raw`. Track Phase 1 progress in [`ROADMAP.md`](../ROADMAP.md).

---

## 13. Unit test webhooks with deterministic jitter

Inject a custom RNG into `WebhookDelivery` to make exponential backoff delays deterministic in your test suite. ✅

```ts
import { Watcher } from "@orbital/pulse-core";
import { WebhookDelivery } from "@orbital/pulse-webhooks";
import { vi } from "vitest";

// A simple seeded RNG for deterministic results
let seed = 12345;
const seededRandom = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const watcher = new Watcher("GABC...");

new WebhookDelivery(watcher, {
  url: "https://example.com/webhook",
  secret: "top-secret",
  retries: 3,
  random: seededRandom, // 👈 Inject RNG here
});
```

Combine this with `vi.useFakeTimers()` to verify that retries happen after the exact jittered delay you expect without waiting for real-world wall clock time.

---

## Related documents

- [`apps/web/content/guides/`](../apps/web/content/guides/) — narrative walkthroughs (real-time events, webhooks)
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — system diagrams, lifecycle, trust boundaries
- [`packages/pulse-core/README.md`](../packages/pulse-core/README.md) — full API reference
- [`packages/pulse-webhooks/README.md`](../packages/pulse-webhooks/README.md) — delivery contract, security
- [`packages/pulse-notify/README.md`](../packages/pulse-notify/README.md) — React hook reference
