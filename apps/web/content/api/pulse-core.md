---
title: pulse-core
description: Event engine for Stellar Horizon — normalization, watchers, reconnection.
---

## Overview

`@orbital/pulse-core` opens a streaming connection to Horizon, normalizes each incoming record into a uniform `NormalizedEvent`, and emits it to any `Watcher` subscribed to the affected address. Reconnection, backoff, and rate-limit handling are automatic.

Install when you want to consume Stellar events in-process — typically inside a server, background worker, or CLI. Layer [`@orbital/pulse-webhooks`](./pulse-webhooks) or [`@orbital/pulse-notify`](./pulse-notify) on top for delivery and React integration.

## Installation

```bash
pnpm add @orbital/pulse-core
```

## EventEngine

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({
  network: "testnet",
  reconnect: { initialDelayMs: 1000, maxDelayMs: 30_000 },
});

engine.start();
```

### Constructor config (`CoreConfig`)

| Field | Type | Description |
|---|---|---|
| `network` | `"mainnet" \| "testnet"` | Which Stellar network to connect to |
| `horizonUrl` | `string` | Override the Horizon URL (private node, regional mirror, futurenet) |
| `reconnect.initialDelayMs` | `number` | First retry delay (default `1000`) |
| `reconnect.maxDelayMs` | `number` | Backoff ceiling (default `30_000`) |
| `reconnect.maxRetries` | `number` | Retry budget (default `Infinity`) |

### `engine.start(options?)` → `boolean`

Opens the SSE stream. Returns `true` on a successful start, `false` if the engine was already running. Pass `{ strict: true }` to throw `EngineAlreadyStartedError` instead.

### `engine.stop()`

Closes the upstream connection and tears down all watchers. Emits `engine.stopped` to subscribed listeners before tearing down.

### `engine.subscribe(address, options?)` → `Watcher`

Returns a `Watcher` for the given Stellar public key. Watchers are deduplicated — calling `subscribe` twice with the same address returns the same instance.

### `engine.unsubscribe(address)`

Stops and removes the watcher for the given address.

### `engine.unsubscribeAll()`

Stops and removes every active watcher.

### `engine.status()` → `EngineStatus`

Returns a snapshot of engine health (connection state, watcher count, last event time, current backoff state).

## Watcher

`Watcher` is the per-address pub/sub interface. Subscribe to specific event types, multiple types, or `"*"` for everything.

```ts
const watcher = engine.subscribe("GABC...");

watcher.on("payment.received", (event) => { /* ... */ });
watcher.on("trustline.added", (event) => { /* ... */ });
watcher.on("*", (event) => { /* ... */ });
```

Once a watcher is stopped, listeners added afterward log a warning and are not registered. Use `{ strictStoppedListeners: true }` if you want this to throw instead.

## Event taxonomy

Every event delivered to a `Watcher` is a member of the `NormalizedEvent` discriminated union — `switch` on `event.type` for full TypeScript narrowing.

| Event type | Fired when |
|---|---|
| `payment.received` | The address is the recipient of a payment |
| `payment.sent` | The address is the sender of a payment |
| `payment.self` | The address is both sender and recipient |
| `account.created` | A `create_account` operation funded this address |
| `account.merged` | An `account_merge` operation involved this address |
| `account.options_changed` | A `set_options` operation modified this account |
| `account.bump_sequence` | A `bump_sequence` operation ran on this account |
| `trustline.added` | A `change_trust` operation created a new trustline |
| `trustline.updated` | A `change_trust` operation modified an existing trustline limit |
| `trustline.removed` | A `change_trust` operation removed a trustline |
| `trustline.authorized` | An `allow_trust` or `set_trust_line_flags` granted authorization |
| `trustline.deauthorized` | An `allow_trust` or `set_trust_line_flags` revoked authorization |
| `offer.created` | A `manage_offer` operation created a new DEX offer |
| `offer.updated` | A `manage_offer` operation modified an existing offer |
| `offer.deleted` | A `manage_offer` operation removed an offer |
| `claimable.created` | A `create_claimable_balance` operation created a new claim |
| `claimable.claimed` | A `claim_claimable_balance` operation consumed a claim |
| `lp.deposited` | A `liquidity_pool_deposit` operation involved this account |
| `lp.withdrawn` | A `liquidity_pool_withdraw` operation involved this account |
| `data.set` | A `manage_data` operation set or updated a data entry |
| `data.cleared` | A `manage_data` operation removed a data entry |

Soroban contract events (`contract.event`, etc.) are coming in Phase 1 — see the [roadmap](https://github.com/orbital/orbital/blob/main/ROADMAP.md).

## Engine notifications

In addition to event payloads, watchers receive lifecycle notifications:

| Notification | Fired when |
|---|---|
| `engine.reconnecting` | The engine is retrying its upstream connection |
| `engine.reconnected` | Reconnect succeeded |
| `engine.rate_limited` | Horizon returned HTTP 429; engine will retry after the delay |
| `engine.stopped` | `engine.stop()` was called |
| `engine.cursor_expired` | The stream cursor has expired or is no longer valid, requiring a reset |

For `engine.cursor_expired` notifications, the payload includes extra fields:
- `lostCursor?: string` — The value of the expired or lost cursor.
- `source?: "horizon" | "soroban"` — The subscription engine source where the expiry occurred.

## NormalizedEvent shape

The exact shape varies per event type; the shared envelope is:

```ts
type NormalizedEventBase = {
  type: string;        // discriminator — see taxonomy table
  emittedAt: string;   // ISO 8601 timestamp the engine emitted the event
  raw: unknown;        // Original Horizon record, for escape-hatch inspection
};
```

For example, a payment event extends this with `to`, `from`, `amount`, `asset`. A trustline event extends it with `asset` and the limit. See `packages/pulse-core/src/index.ts` for the full type definitions.

**Amounts are strings.** Stellar uses 7-decimal fixed-point, and JavaScript numbers lose precision past 15 digits. Treat all amounts as strings and delegate arithmetic to `bignumber.js` or similar.

## Filter predicates

`engine.subscribe()` accepts an optional filter predicate to drop events before they're delivered to listeners:

```ts
const watcher = engine.subscribe("GABC...", {
  filter: (event) => event.type === "payment.received" && event.asset === "XLM",
});
```

## Custom Horizon URL

Set `horizonUrl` on the config to point at a self-hosted node, regional mirror, or futurenet:

```ts
const engine = new EventEngine({
  network: "mainnet",
  horizonUrl: "https://horizon.my-infra.example.com",
});
```

## License

MIT
