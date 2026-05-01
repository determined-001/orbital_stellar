# @orbital/pulse-notify

**React hooks for live Stellar events.** Drop a hook into any component and receive real-time payment, activity, or custom event streams from an Orbital server — with automatic reconnection and zero wiring.

```bash
pnpm add @orbital/pulse-notify react
```

Requires React 18 or 19. Designed for Next.js App Router, Vite, Remix, and plain React apps.

## What it does

`pulse-notify` opens a browser-native `EventSource` connection to your Orbital server, subscribes to an address, and re-renders your component whenever a new event arrives. It is intentionally thin — no global store, no custom cache, no peer-dependency on a state manager.

You point the hook at your own Orbital server (self-hosted or managed) and pass the address you want to watch.

## Quickstart

```tsx
"use client";
import { useStellarPayment } from "@orbital/pulse-notify";

export function LiveBalance({ address }: { address: string }) {
  const { event, connected, error } = useStellarPayment(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address
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

## Hooks

### `useStellarEvent(serverUrl, address, options?)`

The core hook. Subscribes to one event type, an allowlist of types, or all events on an address.

```ts
// Single type
const { event, connected, error } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: "payment.received" }
);

// Multiple types — subscribe to both without opening two connections
const { event } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: ["payment.received", "payment.sent"] }
);

// All events (default)
const { event } = useStellarEvent(
  "https://events.example.com",
  "GABC...",
  { event: "*", token: "orb_live_abc..." }
);
```

Also accepts a single config object — see [Stable config](#stable-config) for when that matters.

### `useStellarPayment(serverUrl, address)`

Shorthand for payments received. Equivalent to `useStellarEvent(serverUrl, address, { event: "payment.received" })`.

### `useStellarActivity(serverUrl, address)`

Shorthand for all events on an address. Equivalent to `useStellarEvent(serverUrl, address, { event: "*" })`.

## Return shape

```ts
type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;     // Latest event, or null before first arrival
  connected: boolean;  // True once the SSE handshake completes
  error: string | null; // Error message if the connection fails
};
```

## Type narrowing

`useStellarEvent` is generic — pass a narrower union as `T` to get full IDE support and avoid manual casts. Use TypeScript's `Extract` to pull specific event types out of `NormalizedEvent`:

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
    { event: ["payment.received", "payment.sent", "trustline.added"] }
  );

  if (!event) return null;

  // event.type is now "payment.received" | "payment.sent" | "trustline.added"
  // — TS narrows the rest of the shape per branch.
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
      return <div>{event.amount} {event.asset}</div>;
    case "trustline.added":
      return <div>Added {event.asset}</div>;
  }
}
```

The default `T = NormalizedEvent` keeps the existing untyped behavior — pass `<T>` only when you want narrowing.

Every render returns the *most recent* event. If you need history, accumulate it yourself in component state:

```tsx
const [history, setHistory] = useState<NormalizedEvent[]>([]);
const { event } = useStellarActivity(url, address);

useEffect(() => {
  if (event) setHistory((h) => [event, ...h].slice(0, 50));
}, [event]);
```

## Stable config

`useStellarEvent`'s `useEffect` depends on each primitive field — `serverUrl`, `address`, `event`, `token` — not on the config object's identity. The hook itself is safe from reference-equality churn.

That said, passing a fresh `{...}` literal to the object form of the hook is still a code smell: React recreates the object every render, which is wasteful and obscures what the hook actually depends on. Prefer the primitives-first signature at inline call sites — because you're passing scalars directly, there's nothing to stabilise:

```tsx
// ✅ Primitives-first — always stable, no extra work needed
function MyComponent({ address }: { address: string }) {
  const { event } = useStellarEvent(
    "https://events.example.com",
    address,
    { event: "payment.received" }
  );
}
```

**Array literals need the same treatment.** `["payment.received", "payment.sent"]` is a new reference every render, just like an object literal. The hook serialises the array internally so the effect stays stable — but if you're passing the array from props or building it inline, hoist or memoize it so your component doesn't re-render unnecessarily:

```tsx
// ✅ Hoisted constant — created once
const PAYMENT_EVENTS = ["payment.received", "payment.sent"];

function MyComponent({ address }: { address: string }) {
  const { event } = useStellarEvent(
    "https://events.example.com",
    address,
    { event: PAYMENT_EVENTS }
  );
}

// ✅ useMemo — when the list depends on props or state
function MyComponent({ address, types }: { address: string; types: string[] }) {
  const options = useMemo(() => ({ event: types }), [types]);
  const { event } = useStellarEvent("https://events.example.com", address, options);
}
```

If you need the object form and the config depends on props or state, wrap it in `useMemo`:

```tsx
// ✅ Object form with useMemo — recreated only when deps change
function MyComponent({ address, token }: { address: string; token?: string }) {
  const config = useMemo(
    () => ({ serverUrl: "https://events.example.com", address, token }),
    [address, token]
  );

  const { event } = useStellarEvent(config);
}
```

```tsx
// ❌ Inline object literal — new reference every render
function MyComponent({ address }: { address: string }) {
  const { event } = useStellarEvent({
    serverUrl: "https://events.example.com",
    address,
  });
}
```

## Authentication

If your Orbital server enforces API-key auth, pass `token` in the config. The hook forwards it as a `?token=` query parameter (since `EventSource` does not support custom headers in browsers).

```tsx
useStellarEvent(
  serverUrl,
  address,
  { token: process.env.NEXT_PUBLIC_ORBITAL_TOKEN }
);
```

**Server-only tokens** (secrets) must never ship to the browser. Use a per-user short-lived token issued by your backend.

## Server-side rendering

The hooks are client-only — they rely on `EventSource`, which does not exist in Node. In Next.js App Router, mark the consuming component with `"use client"`. In Remix or Vite SSR, gate the hook behind a client-only boundary.

## Current limitations

- One connection per hook instance. Deduplication across components watching the same address is a planned enhancement.
- No offline queue. Events that arrive while the tab is backgrounded and the connection is closed are not replayed on reconnect.
- `EventSource` reconnect is browser-controlled. Fine-grained retry policy belongs in a future WebSocket-based transport.

## License

MIT
