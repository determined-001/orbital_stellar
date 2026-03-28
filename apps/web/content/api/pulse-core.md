---
title: pulse-core
description: Core event streaming engine for Stellar Horizon.
---

## Overview

`@orbital/pulse-core` is the foundation of Orbital Stellar. It connects to Horizon's payment SSE stream, normalizes events, and routes them to address-specific `Watcher` instances.

## Installation

```bash
npm install @orbital/pulse-core
```

## EventEngine

The `EventEngine` class manages the Horizon connection and dispatches events.

### Constructor

```typescript
import { EventEngine } from '@orbital/pulse-core'

const engine = new EventEngine({
  network: 'testnet', // or 'mainnet'
})
```

### `engine.watch(address)`

Returns a `Watcher` instance for the given address. Creates one if it doesn't exist.

```typescript
const watcher = engine.watch('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')
```

### `engine.unwatch(address)`

Stops watching an address and cleans up the watcher.

```typescript
engine.unwatch('G...')
```

## Watcher

`Watcher` extends Node.js `EventEmitter` and emits normalized events for a specific address.

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `payment.received` | `NormalizedEvent` | Payment arrived at this address |
| `payment.sent` | `NormalizedEvent` | Payment left this address |
| `*` | `NormalizedEvent` | Any event (both received and sent) |
| `engine.reconnecting` | `void` | Horizon connection dropped |
| `engine.reconnected` | `void` | Connection restored |

### Usage

```typescript
watcher.on('payment.received', (event) => {
  console.log(`Received ${event.amount} ${event.asset} from ${event.from}`)
})

watcher.on('*', (event) => {
  console.log('Any event:', event.type)
})

// Stop listening
watcher.stop()
```

## NormalizedEvent

```typescript
type NormalizedEvent = {
  type: 'payment.received' | 'payment.sent'
  to: string
  from: string
  amount: string     // "100.0000000"
  asset: string      // "XLM" or "USDC:GBBD47..."
  timestamp: string  // ISO 8601
  raw: unknown       // original Horizon record
}
```

## Reconnection

`EventEngine` uses exponential backoff for reconnection:

- Initial delay: **1 second**
- Multiplier: **2×** per attempt
- Maximum delay: **30 seconds**
