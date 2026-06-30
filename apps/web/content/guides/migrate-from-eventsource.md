---
title: Migrate from raw EventSource to useStellarEvent
description: Before/after for the three most common raw EventSource patterns.
---

If you're currently wiring a browser `EventSource` by hand to consume an Orbital backend, this guide shows you how to replace that code with `@orbital-stellar/pulse-notify` hooks and what you gain from doing so.

## Why migrate

Raw `EventSource` requires you to write the same wiring every time: open the connection, parse JSON, handle `onerror`, call `.close()` in a cleanup effect, and re-open when the address changes. `pulse-notify` does all of that and shares one underlying connection across hook instances that watch the same endpoint.

## Pattern 1 — listen for a single event type

### Before

```tsx
"use client";
import { useEffect, useState } from "react";

interface PaymentEvent {
  type: "payment.received";
  amount: string;
  asset: string;
  from: string;
  timestamp: string;
}

export function LivePayments({ address }: { address: string }) {
  const [event, setEvent] = useState<PaymentEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_ORBITAL_URL}/events/${address}?type=payment.received`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        setEvent(JSON.parse(e.data));
      } catch {
        setError("Failed to parse event");
      }
    };

    es.onerror = () => {
      setError("Connection error");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [address]);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!event) return <div>Listening for payments…</div>;

  return (
    <div>
      +{event.amount} {event.asset} from {event.from.slice(0, 8)}…
    </div>
  );
}
```

### After

```tsx
"use client";
import { useStellarPayment } from "@orbital-stellar/pulse-notify";

export function LivePayments({ address }: { address: string }) {
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

`useStellarPayment` is a shorthand for `useStellarEvent(serverUrl, address, { event: "payment.received" })`. It handles connection lifecycle and JSON parsing internally.

---

## Pattern 2 — listen for multiple event types

### Before

```tsx
"use client";
import { useEffect, useState } from "react";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

const TYPES = ["payment.received", "payment.sent", "trustline.added"];

export function ActivityFeed({ address }: { address: string }) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);

  useEffect(() => {
    const sources = TYPES.map((type) => {
      const url = `${process.env.NEXT_PUBLIC_ORBITAL_URL}/events/${address}?type=${type}`;
      const es = new EventSource(url);

      es.onmessage = (e) => {
        try {
          const event: NormalizedEvent = JSON.parse(e.data);
          setEvents((prev) => [event, ...prev].slice(0, 50));
        } catch {
          // ignore parse errors
        }
      };

      return es;
    });

    return () => {
      sources.forEach((es) => es.close());
    };
  }, [address]);

  if (!events.length) return <div>No activity yet…</div>;

  return (
    <ul>
      {events.map((e, i) => (
        <li key={i}>{e.type}</li>
      ))}
    </ul>
  );
}
```

### After

```tsx
"use client";
import { useEffect, useState } from "react";
import { useStellarEvent } from "@orbital-stellar/pulse-notify";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

const PAYMENT_TYPES = ["payment.received", "payment.sent", "trustline.added"] as const;

export function ActivityFeed({ address }: { address: string }) {
  const [history, setHistory] = useState<NormalizedEvent[]>([]);

  const { event } = useStellarEvent(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
    { event: PAYMENT_TYPES }
  );

  useEffect(() => {
    if (event) setHistory((h) => [event, ...h].slice(0, 50));
  }, [event]);

  if (!history.length) return <div>No activity yet…</div>;

  return (
    <ul>
      {history.map((e, i) => (
        <li key={i}>{e.type}</li>
      ))}
    </ul>
  );
}
```

One hook, one connection — regardless of how many event types you subscribe to. Hoist the types array as a constant (or `useMemo` it) so the hook's effect stays stable across renders.

---

## Pattern 3 — authenticated connection with a bearer token

### Before

```tsx
"use client";
import { useEffect, useState } from "react";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

export function SecureEventStream({
  address,
  token,
}: {
  address: string;
  token: string;
}) {
  const [event, setEvent] = useState<NormalizedEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_ORBITAL_URL}/events/${address}?token=${token}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        setEvent(JSON.parse(e.data));
      } catch {
        setError("Failed to parse event");
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError("Connection error");
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [address, token]);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!connected) return <div>Connecting…</div>;
  if (!event) return <div>Waiting for events…</div>;

  return <div>{event.type}</div>;
}
```

### After

```tsx
"use client";
import { useStellarEvent } from "@orbital-stellar/pulse-notify";

export function SecureEventStream({
  address,
  token,
}: {
  address: string;
  token: string;
}) {
  const { event, connected, error } = useStellarEvent(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
    { event: "*", token }
  );

  if (error) return <div className="text-red-500">{error}</div>;
  if (!connected) return <div>Connecting…</div>;
  if (!event) return <div>Waiting for events…</div>;

  return <div>{event.type}</div>;
}
```

`pulse-notify` appends the token as `?token=` automatically — the same convention your raw code was using, without the manual string interpolation. The hook reconnects with the new token whenever `token` changes.

> **Note:** `EventSource` does not support custom `Authorization` headers in browsers. Always pass secrets as short-lived per-user tokens, never long-lived API keys. See the [pulse-notify README](../../../packages/pulse-notify/README.md#authentication) for details.

---

## Installation

```bash
pnpm add @orbital-stellar/pulse-notify react
```

Requires React 18 or 19.
