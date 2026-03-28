---
title: pulse-notify
description: React hooks for subscribing to real-time Stellar events.
---

## Overview

`@orbital/pulse-notify` provides React hooks that connect to the Orbital server's SSE stream and expose live Stellar events in your components.

## Installation

```bash
npm install @orbital/pulse-notify
```

**Peer dependencies:** React 18 or 19.

## useStellarEvent

The base hook for subscribing to events on an address.

```tsx
import { useStellarEvent } from '@orbital/pulse-notify'

const { event, connected, error } = useStellarEvent({
  serverUrl: 'http://localhost:3000',
  address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  event: '*',
})
```

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | — | Base URL of the Orbital server |
| `address` | `string` | — | Stellar address to watch |
| `event` | `string` | `'*'` | Event type filter (`'*'`, `'payment.received'`, or `'payment.sent'`) |

### Return value

```typescript
type EventState = {
  event: NormalizedEvent | null  // latest event, null until first event arrives
  connected: boolean             // SSE connection status
  error: Error | null            // connection error, if any
}
```

## useStellarPayment

Convenience hook — only updates on `payment.received` events.

```tsx
import { useStellarPayment } from '@orbital/pulse-notify'

function IncomingPayments({ address }: { address: string }) {
  const { event, connected } = useStellarPayment(
    process.env.NEXT_PUBLIC_SERVER_URL!,
    address
  )

  return (
    <div>
      <span className={connected ? 'text-green-400' : 'text-gray-400'}>
        {connected ? 'Live' : 'Connecting...'}
      </span>
      {event && (
        <p>+{event.amount} {event.asset} from {event.from.slice(0, 8)}...</p>
      )}
    </div>
  )
}
```

## useStellarActivity

Convenience hook — updates on all events (`*`).

```tsx
import { useStellarActivity } from '@orbital/pulse-notify'

const { event, connected } = useStellarActivity(serverUrl, address)
```

## Connection behavior

- Each hook opens one `EventSource` connection per address
- The browser reconnects automatically on disconnect
- Connections are cleaned up when the component unmounts
- Changing `address` or `serverUrl` opens a new connection and closes the old one
