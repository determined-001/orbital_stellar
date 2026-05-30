---
title: pulse-notify
description: React hooks for subscribing to live Stellar events.
---

## Overview

`@orbital/pulse-notify` opens a browser-native `EventSource` connection to a backend that exposes Orbital events as Server-Sent Events, subscribes to an address, and re-renders your component whenever a new event arrives.

The hooks are intentionally thin — no global store, no custom cache, no peer dependency on a state manager. You point them at your own backend (built on `@orbital/pulse-core` — `apps/web` ships a copy-paste reference at `app/api/events/[address]/route.ts`) or at Orbital Cloud (in development), and pass the address you want to watch.

## Installation

```bash
pnpm add @orbital/pulse-notify react
```

**Peer dependency:** React 18 or 19. Designed for Next.js App Router, Vite, Remix, and plain React apps.

## useStellarEvent

The base hook. Subscribes to one event type, an allowlist of types, or all events on an address.

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
  { event: "*", token: "orb_live_abc..." },
);
```

Also accepts a single config object — see the package README for stable-config rules and `useMemo` patterns when passing object literals.

### Config

| Option | Type | Default | Description |
|---|---|---|---|
| `serverUrl` | `string` | — | Base URL of your Orbital-powered backend |
| `address` | `string` | — | Stellar address to watch |
| `event` | `string \| string[]` | `"*"` | Event type filter — see [taxonomy](./pulse-core#event-taxonomy) for all 21 types |
| `token` | `string` | — | API key, forwarded as `?token=` query parameter |

### Return value

```ts
type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;       // Latest event, or null before first arrival
  connected: boolean;    // True once SSE handshake completes
  error: string | null;  // Error message if the connection fails
};
```

## useStellarPayment

Convenience hook — only updates on `payment.received` events. Equivalent to `useStellarEvent(serverUrl, address, { event: "payment.received" })`.

```tsx
import { useStellarPayment } from "@orbital/pulse-notify";

function IncomingPayments({ address }: { address: string }) {
  const { event, connected } = useStellarPayment(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
  );

  return (
    <div>
      <span className={connected ? "text-green-400" : "text-gray-400"}>
        {connected ? "Live" : "Connecting..."}
      </span>
      {event && (
        <p>+{event.amount} {event.asset} from {event.from.slice(0, 8)}...</p>
      )}
    </div>
  );
}
```

## useStellarActivity

Convenience hook — updates on all events (`*`). Equivalent to `useStellarEvent(serverUrl, address, { event: "*" })`.

```tsx
import { useStellarActivity } from "@orbital/pulse-notify";

const { event, connected } = useStellarActivity(serverUrl, address);
```

## Type narrowing

Pass a narrower union as `T` to get full IDE support and avoid manual casts:

```tsx
import type { NormalizedEvent } from "@orbital/pulse-core";
import { useStellarEvent } from "@orbital/pulse-notify";

type WalletEvents = Extract<
  NormalizedEvent,
  { type: "payment.received" | "payment.sent" | "trustline.added" }
>;

const { event } = useStellarEvent<WalletEvents>(
  "https://events.example.com",
  address,
  { event: ["payment.received", "payment.sent", "trustline.added"] },
);
```

`switch (event.type)` will exhaustively narrow the rest of the shape per branch.

## Authentication

If your backend enforces an API token, pass it via the `token` config field. The hook forwards it as a `?token=` query parameter — `EventSource` cannot set custom headers in browsers, so query-string is the only option.

```tsx
useStellarEvent(serverUrl, address, {
  token: process.env.NEXT_PUBLIC_ORBITAL_TOKEN,
});
```

**Never ship server-only secrets to the browser.** Issue per-user short-lived tokens from your backend.

## Server-side rendering

The hooks are client-only — they rely on `EventSource`, which doesn't exist in Node.

- **Next.js App Router:** mark consuming components with `"use client"`
- **Remix or Vite SSR:** gate the hook behind a client-only boundary

## Connection behavior

- Hook instances with the same `serverUrl`, `address`, and `token` share one `EventSource`
- Browser handles reconnection automatically on transient network errors
- Connections are cleaned up on unmount or when `address` / `serverUrl` change
- Each render returns the *most recent* event — accumulate history yourself in component state if needed

## License

MIT
