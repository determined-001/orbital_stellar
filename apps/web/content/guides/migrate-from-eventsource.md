---
title: Migrate from raw EventSource
description: Replace hand-rolled browser EventSource code with @orbital/pulse-notify React hooks.
---

If you already consume an Orbital SSE endpoint with the browser's `EventSource` API, you do not need to change your backend. Orbital servers expose events at:

```
GET {serverUrl}/events/{address}[?token=...]
```

Each message is a standard SSE `data:` frame containing a JSON-serialized `NormalizedEvent` from `@orbital/pulse-core`. `@orbital/pulse-notify` wraps the same URL, parsing, filtering, and connection lifecycle so you can delete repetitive `useEffect` boilerplate.

Install the package if you have not already:

```bash
pnpm add @orbital/pulse-notify react
```

Mark consuming components with `"use client"` in Next.js App Router (the hooks are browser-only).

## What you gain

| Raw `EventSource` | `@orbital/pulse-notify` |
| --- | --- |
| Manual `open` / `close` in `useEffect` | Automatic subscribe/unsubscribe per component mount |
| `JSON.parse` in every `onmessage` | Parsed `NormalizedEvent` on `event` |
| One connection per component | Shared pool per `(serverUrl, address, token)` |
| Hand-rolled `onopen` / `onerror` state | `connected` and `error` on every hook |
| Client-side `type` checks in callbacks | `event` option filters before React state updates |

For connection health UI without event data, use [`<StellarConnectionStatus>`](/docs/api/pulse-notify) instead of opening a second `EventSource`.

---

## Pattern 1 — Manual subscription in `useEffect`

The most common starting point: open an `EventSource` when the component mounts, parse `message.data`, and store the latest event in React state.

### Before

```tsx
"use client";
import { useEffect, useState } from "react";

type StellarEvent = {
  type: string;
  amount?: string;
  asset?: string;
  from?: string;
};

export function LiveBalance({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  const [event, setEvent] = useState<StellarEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${serverUrl}/events/${address}`;
    const source = new EventSource(url);

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as StellarEvent;
        setEvent(parsed);
      } catch {
        setError("Failed to parse event");
      }
    };

    source.onerror = () => {
      setConnected(false);
      setError("Connection lost — retrying...");
    };

    return () => {
      source.close();
    };
  }, [serverUrl, address]);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!connected) return <div>Connecting…</div>;
  if (!event) return <div>Listening…</div>;

  return (
    <div>
      +{event.amount} {event.asset} from {event.from?.slice(0, 8)}…
    </div>
  );
}
```

### After

```tsx
"use client";
import { useStellarActivity } from "@orbital/pulse-notify";

export function LiveBalance({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  const { event, connected, error } = useStellarActivity(serverUrl, address);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!connected) return <div>Connecting…</div>;
  if (!event) return <div>Listening…</div>;

  if (event.type === "payment.received") {
    return (
      <div>
        +{event.amount} {event.asset} from {event.from.slice(0, 8)}…
      </div>
    );
  }

  return <div>Latest: {event.type}</div>;
}
```

For payment-only UIs, prefer `useStellarPayment` — it is equivalent to `useStellarEvent(..., { event: "payment.received" })` and exposes `amountStroop` for bigint math.

---

## Pattern 2 — Client-side event-type filtering

Teams often keep one `EventSource` but ignore most messages, checking `parsed.type` inside `onmessage`.

### Before

```tsx
"use client";
import { useEffect, useState } from "react";

export function PaymentFeed({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  const [payment, setPayment] = useState<{
    amount: string;
    asset: string;
    from: string;
  } | null>(null);

  useEffect(() => {
    const source = new EventSource(`${serverUrl}/events/${address}`);

    source.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as { type: string };
      if (parsed.type !== "payment.received") return;
      setPayment(parsed as { amount: string; asset: string; from: string });
    };

    return () => source.close();
  }, [serverUrl, address]);

  if (!payment) return <div>Waiting for a payment…</div>;

  return (
    <div>
      +{payment.amount} {payment.asset}
    </div>
  );
}
```

### After

```tsx
"use client";
import { useStellarPayment } from "@orbital/pulse-notify";

export function PaymentFeed({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  const { event: payment, connected } = useStellarPayment(serverUrl, address);

  if (!connected) return <div>Connecting…</div>;
  if (!payment) return <div>Waiting for a payment…</div>;

  return (
    <div>
      +{payment.amount} {payment.asset}
    </div>
  );
}
```

Subscribe to several types on one connection with an allowlist:

```tsx
import { useStellarEvent } from "@orbital/pulse-notify";

const { event } = useStellarEvent(serverUrl, address, {
  event: ["payment.received", "payment.sent"],
});
```

Use `event: "*"` (or `useStellarActivity`) when you need every event type.

---

## Pattern 3 — Multiple `EventSource` instances per address

Another common layout: each child component opens its own `EventSource` to the same wallet. That duplicates TCP connections and parses the same payload multiple times.

### Before

```tsx
"use client";
import { useEffect, useState } from "react";

function PaymentBadge({ serverUrl, address }: { serverUrl: string; address: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const source = new EventSource(`${serverUrl}/events/${address}`);
    source.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as { type: string };
      if (parsed.type === "payment.received") {
        setCount((n) => n + 1);
      }
    };
    return () => source.close();
  }, [serverUrl, address]);

  return <span>{count} payments</span>;
}

function ActivityLine({ serverUrl, address }: { serverUrl: string; address: string }) {
  const [label, setLabel] = useState("Listening…");

  useEffect(() => {
    const source = new EventSource(`${serverUrl}/events/${address}`);
    source.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as { type: string };
      setLabel(parsed.type);
    };
    return () => source.close();
  }, [serverUrl, address]);

  return <span>{label}</span>;
}

export function WalletDashboard({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  return (
    <div>
      <PaymentBadge serverUrl={serverUrl} address={address} />
      <ActivityLine serverUrl={serverUrl} address={address} />
    </div>
  );
}
```

### After

```tsx
"use client";
import { useEffect, useState } from "react";
import { useStellarPayment, useStellarActivity } from "@orbital/pulse-notify";

function PaymentBadge({ serverUrl, address }: { serverUrl: string; address: string }) {
  const [count, setCount] = useState(0);
  const { event } = useStellarPayment(serverUrl, address);

  useEffect(() => {
    if (event) setCount((n) => n + 1);
  }, [event]);

  return <span>{count} payments</span>;
}

function ActivityLine({ serverUrl, address }: { serverUrl: string; address: string }) {
  const { event } = useStellarActivity(serverUrl, address);
  return <span>{event?.type ?? "Listening…"}</span>;
}

export function WalletDashboard({
  serverUrl,
  address,
}: {
  serverUrl: string;
  address: string;
}) {
  return (
    <div>
      <PaymentBadge serverUrl={serverUrl} address={address} />
      <ActivityLine serverUrl={serverUrl} address={address} />
    </div>
  );
}
```

`pulse-notify` keeps one browser `EventSource` per `(serverUrl, address, token)` and applies each hook's `event` filter independently. Different addresses or tokens still open separate connections.

---

## Authentication and cookies

`EventSource` cannot set custom headers in browsers. If you authenticated with a query parameter before, keep doing so — pass `token` in the hook config:

```tsx
// Before
const source = new EventSource(
  `${serverUrl}/events/${address}?token=${encodeURIComponent(token)}`
);

// After
useStellarEvent(serverUrl, address, { token });
```

For same-origin `httpOnly` cookies, pass `withCredentials: true` (your server must respond with `Access-Control-Allow-Credentials: true` and an explicit origin when cross-origin).

**Never ship server-only secrets to the browser.** Issue short-lived, per-user tokens from your backend.

---

## Event history and side effects

Hooks expose only the *latest* event. If you accumulated history in `onmessage`, keep that pattern with `useEffect`:

```tsx
import type { NormalizedEvent } from "@orbital/pulse-core";
import { useStellarActivity } from "@orbital/pulse-notify";

const [history, setHistory] = useState<NormalizedEvent[]>([]);
const { event } = useStellarActivity(serverUrl, address);

useEffect(() => {
  if (event) setHistory((h) => [event, ...h].slice(0, 50));
}, [event]);
```

For logging or analytics that should not trigger a re-render, use `onEvent`:

```tsx
import { useStellarEvent } from "@orbital/pulse-notify";

useStellarEvent(serverUrl, address, {
  event: "*",
  onEvent: (incoming) => {
    analytics.track("stellar_event", { type: incoming.type });
  },
});
```

---

## Checklist

- [ ] Replace manual `EventSource` `useEffect` blocks with `useStellarEvent`, `useStellarPayment`, or `useStellarActivity`
- [ ] Move `type` checks into the hook's `event` option instead of filtering inside `onmessage`
- [ ] Collapse duplicate connections to the same address into multiple hooks (one shared `EventSource`)
- [ ] Add `"use client"` where required
- [ ] Keep `?token=` or `withCredentials` auth equivalent to your previous URL

## Next steps

- [Real-time events guide](./real-time-events) — SSE backend shape, type narrowing, heartbeats
- [pulse-notify API reference](/docs/api/pulse-notify) — full hook surface
- [Package README](../../../packages/pulse-notify/README.md) — stable config, limitations, related docs
