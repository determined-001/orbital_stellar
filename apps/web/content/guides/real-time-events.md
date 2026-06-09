---
title: Real-time Events
description: Stream live Stellar events with @orbital/pulse-core and React hooks.
---

There are two ways to consume Orbital events in real time:

1. **Server-side** — `@orbital/pulse-core` opens a streaming connection to Horizon directly. Use this in Node.js, edge workers, or background processes.
2. **Browser-side** — `@orbital/pulse-notify` React hooks open a browser `EventSource` to a backend you operate (which uses `pulse-core` under the hood).

The server-side path is the lowest layer; the React hooks sit on top.

## Server-side subscription with `pulse-core`

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({
  network: "testnet",
  reconnect: { initialDelayMs: 1000, maxDelayMs: 30_000 },
});

engine.start();

const watcher = engine.subscribe("GABC...");

watcher.on("payment.received", (event) => {
  console.log(`+${event.amount} ${event.asset}`);
});

watcher.on("trustline.added", (event) => {
  console.log(`new trustline for ${event.asset}`);
});

watcher.on("*", (event) => {
  console.log(`event ${event.type}`, event);
});
```

Reconnection is handled automatically — `pulse-core` uses AWS Full Jitter backoff and exposes notification events (`engine.reconnecting`, `engine.reconnected`, `engine.rate_limited`, `engine.stopped`) you can subscribe to for observability.

Always call `engine.stop()` in your shutdown path.

## Browser-side with React hooks

`@orbital/pulse-notify` opens an `EventSource` connection to a backend that exposes Orbital events as Server-Sent Events. The `apps/web` marketing site ships a Next.js route handler that does this (`app/api/events/[address]/route.ts`); you can copy that or stand up an equivalent SSE endpoint with about 30 lines of `pulse-core` + Express in your own backend.

### Standing up an SSE endpoint

If you're not using the reference server, here's the shape of what your backend needs to expose:

```ts
import { EventEngine } from "@orbital/pulse-core";
import express from "express";

const app = express();
const engine = new EventEngine({ network: "testnet" });
engine.start();

app.get("/events/:address", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const watcher = engine.subscribe(req.params.address);
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  watcher.on("*", send);

  req.on("close", () => {
    watcher.off("*", send);
  });
});

app.listen(3000);
```

That endpoint is what the React hooks point at via `serverUrl`.

### `useStellarEvent`

Subscribe to one event type, several types, or all events on an address:

```tsx
"use client";
import { useStellarEvent } from "@orbital/pulse-notify";

// Single type
const { event, connected, error } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: "payment.received" },
);

// Multiple types — one connection
const { event } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: ["payment.received", "payment.sent"] },
);

// All events
const { event } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: "*" },
);
```

### `useStellarPayment` and `useStellarActivity`

Convenience wrappers:

```tsx
const { event, connected } = useStellarPayment(serverUrl, address);  // payment.received only
const { event, connected } = useStellarActivity(serverUrl, address); // all events
```

### Return shape

```ts
type EventState<T = NormalizedEvent> = {
  event: T | null;       // Latest event, or null before first arrival
  connected: boolean;    // True once SSE handshake completes
  error: string | null;  // Error message if the connection fails
};
```

Every render returns the *most recent* event. If you need history, accumulate it in component state:

```tsx
const [history, setHistory] = useState<NormalizedEvent[]>([]);
const { event } = useStellarActivity(serverUrl, address);

useEffect(() => {
  if (event) setHistory((h) => [event, ...h].slice(0, 50));
}, [event]);
```

## Type narrowing

`useStellarEvent` is generic — pass a narrower union as `T` to get full IDE support and avoid manual casts:

```tsx
import type { NormalizedEvent } from "@orbital/pulse-core";
import { useStellarEvent } from "@orbital/pulse-notify";

type WalletEvents = Extract<
  NormalizedEvent,
  { type: "payment.received" | "payment.sent" | "trustline.added" }
>;

function Wallet({ address }: { address: string }) {
  const { event } = useStellarEvent<WalletEvents>(
    "https://events.example.com",
    address,
    { event: ["payment.received", "payment.sent", "trustline.added"] },
  );

  if (!event) return null;

  switch (event.type) {
    case "payment.received":
    case "payment.sent":
      return <div>{event.amount} {event.asset}</div>;
    case "trustline.added":
      return <div>added {event.asset}</div>;
  }
}
```

## Authentication

If your backend enforces an API token, pass it via the `token` config field. The hook forwards it as a `?token=` query parameter (since `EventSource` cannot set custom headers in browsers):

```tsx
useStellarEvent(serverUrl, address, {
  token: process.env.NEXT_PUBLIC_ORBITAL_TOKEN,
});
```

**Server-only secrets must never ship to the browser.** Issue per-user short-lived tokens from your backend.

## Connection lifecycle

- The browser's `EventSource` reconnects automatically on disconnect
- Hook instances with the same `serverUrl`, `address`, and `token` share one browser connection while keeping their own event filters
- Clean shutdown: when your backend exits, send a custom `shutdown` event so clients can distinguish planned restarts from network failures
- Heartbeats every ~30 seconds keep the connection alive through proxies and load balancers
