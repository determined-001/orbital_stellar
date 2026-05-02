---
title: Real-time Events
description: Stream live Stellar events with SSE and React hooks.
---

## Server-Sent Events

The Orbital server exposes an SSE endpoint that pushes events in real time:

```
GET /events/:address
```

### Browser (native)

```typescript
const address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'
const source = new EventSource(`${SERVER_URL}/events/${address}`)

source.onmessage = (e) => {
  const event = JSON.parse(e.data)
  console.log(event.type, event.amount, event.asset)
}

source.onerror = () => {
  console.log('Connection lost, browser will retry automatically')
}

// Cleanup
source.close()
```

### Node.js (backend)

```typescript
import EventSource from 'eventsource'

const source = new EventSource(`${SERVER_URL}/events/${address}`)
source.onmessage = (e) => { /* ... */ }
```

## React hooks

`@orbital/pulse-notify` wraps the SSE connection in convenient React hooks.

### `useStellarEvent`

The base hook — subscribe to any event type:

```tsx
import { useStellarEvent } from '@orbital/pulse-notify'

const { event, connected, error } = useStellarEvent({
  serverUrl: process.env.NEXT_PUBLIC_SERVER_URL!,
  address: 'G...',
  event: '*',  // '*' = all events, or 'payment.received', 'payment.sent'
})
```

### `useStellarPayment`

Convenience hook that only fires on `payment.received`:

```tsx
const { event, connected } = useStellarPayment(serverUrl, address)
```

### `useStellarActivity`

Fires on all events (`*`):

```tsx
const { event, connected } = useStellarActivity(serverUrl, address)
```

### Return values

| Field | Type | Description |
|-------|------|-------------|
| `event` | `NormalizedEvent \| null` | The latest event, or `null` if none yet |
| `connected` | `boolean` | Whether the SSE connection is active |
| `error` | `Error \| null` | Connection error, if any |

## Event type reference

```typescript
type NormalizedEvent = {
  type: 'payment.received' | 'payment.sent'
  to: string        // destination address
  from: string      // source address
  amount: string    // formatted amount (e.g. "100.0000000")
  asset: string     // "XLM" or "USDC:issuer"
  timestamp: string // ISO 8601
  raw: unknown      // original Horizon record
}
```

## Connection lifecycle

The server sends a heartbeat every 30 seconds to keep the connection alive through proxies and load balancers:

```
: heartbeat
```

### Graceful shutdown

When the server shuts down gracefully, it sends a special `shutdown` event to all active SSE connections before closing them:

```
event: shutdown
data: {}

```

This allows clients to distinguish between planned server shutdowns and unexpected connection failures. Clients can use this signal to:

1. Show a "server restarting" message to users
2. Attempt to reconnect to a different server instance
3. Clean up resources gracefully

#### Handling shutdown events

```typescript
const source = new EventSource(`${SERVER_URL}/events/${address}`)

source.addEventListener('shutdown', (e) => {
  console.log('Server is shutting down, attempting reconnection...')
  // Implement reconnection logic here
  source.close()
  setTimeout(() => {
    // Reconnect to same or different server
    const newSource = new EventSource(`${SERVER_URL}/events/${address}`)
  }, 1000)
})

source.onmessage = (e) => {
  const event = JSON.parse(e.data)
  // Handle normal events
}
```

Browsers reconnect automatically on disconnect. For custom reconnection logic, use the `EventSource` constructor with a `reconnectInterval` option.
