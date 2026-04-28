# @orbital/pulse-core

**The event engine at the center of Orbital.** Subscribes to Stellar network activity, normalizes it into a typed event model, and routes it to per-address watchers.

```bash
pnpm add @orbital/pulse-core
```

## What it does

`pulse-core` opens a single streaming connection to Horizon (and, coming soon, Stellar RPC for Soroban events), normalizes each incoming record into a uniform shape, and emits it to any `Watcher` subscribed to the affected address. Reconnection, backoff, and cleanup are handled automatically.

You install `pulse-core` when you want to consume Stellar events in-process — typically inside a server, background worker, or CLI. If you need webhook delivery or React integration, layer [`@orbital/pulse-webhooks`](../pulse-webhooks) or [`@orbital/pulse-notify`](../pulse-notify) on top.

## Quickstart

```ts
import { EventEngine } from "@orbital/pulse-core";

const engine = new EventEngine({
  network: "testnet",
  reconnect: { initialDelayMs: 1000, maxDelayMs: 30_000 },
});

engine.start();

const watcher = engine.subscribe("GABC...");
watcher.on("payment.received", (event) => {
  console.log(`Received ${event.amount} ${event.asset} from ${event.from}`);
});
watcher.on("payment.sent", (event) => {
  console.log(`Sent ${event.amount} ${event.asset} to ${event.to}`);
});
watcher.on("payment.self", (event) => {
  console.log(`Self-payment of ${event.amount} ${event.asset}`);
});
```

## API

### `new EventEngine(config)`

| Field | Type | Description |
|---|---|---|
| `config.network` | `"mainnet" \| "testnet"` | Which Stellar network to connect to |
| `config.reconnect.initialDelayMs` | `number` | First retry delay (default `1000`) |
| `config.reconnect.maxDelayMs` | `number` | Backoff ceiling (default `30_000`) |
| `config.reconnect.maxRetries` | `number` | Retry budget (default `Infinity`) |

### `engine.start()` / `engine.stop()`

Open or close the SSE stream. Idempotent — calling `start()` twice logs a warning and returns.

### `engine.subscribe(address)` → `Watcher`

Returns a `Watcher` for the given Stellar public key. Watchers are deduplicated — calling `subscribe` twice with the same address returns the same instance.

### `engine.unsubscribe(address)`

Stops and removes the watcher for the given address.

### `Watcher` events

| Event | Payload | Fired when |
|---|---|---|
| `payment.received` | `NormalizedEvent` | The address is the recipient of a payment |
| `payment.sent` | `NormalizedEvent` | The address is the sender of a payment |
| `payment.self` | `NormalizedEvent` | The address is both sender and recipient of a payment |
| `*` | `NormalizedEvent` | Any event on this address |
| `engine.reconnecting` | `WatcherNotification` | The engine is retrying its upstream connection |
| `engine.reconnected` | `WatcherNotification` | Reconnect succeeded |

### `NormalizedEvent` shape

```ts
type NormalizedEvent = {
  type: "payment.received" | "payment.sent" | "payment.self";
  to: string;       // Stellar public key
  from: string;     // Stellar public key
  amount: string;   // Decimal string (never a JS number)
  asset: string;    // "XLM" or "CODE:ISSUER"
  timestamp: string; // ISO 8601
  raw: unknown;     // Original Horizon record, for escape-hatch inspection
};
```

## Design principles

- **Amounts are strings.** Stellar uses 7-decimal fixed-point. JavaScript numbers lose precision. Treat all amounts as strings and delegate arithmetic to `bignumber.js` or similar.
- **Watchers are cheap.** They do nothing until events arrive for their address. Create thousands without worrying about overhead.
- **Cleanup is mandatory.** Always call `engine.stop()` in your shutdown path. Watchers clean themselves up via `addStopHandler`.
- **The raw record is preserved.** `event.raw` contains the original Horizon payload. If Orbital's normalization loses information you need, it's still there.

## Benchmark

`pulse-core` includes a reproducible throughput benchmark at `bench/throughput.ts`.

Run it with:

```bash
pnpm --filter @orbital/pulse-core exec node --expose-gc --import tsx bench/throughput.ts --records=100000
```

The harness subscribes `N` watchers and replays `M` synthetic payment records through the engine's normalize + route path, then reports memory and routed events/sec.

### Headline numbers (Node v25.1.0, `M=100000`)

| Watchers (`N`) | Routed events | Duration (ms) | Events/sec | Subscribed heap (MB) | Post-replay heap (MB) | Post-replay RSS (MB) |
|---|---:|---:|---:|---:|---:|---:|
| 1,000 | 400,000 | 258.05 | 1,550,110.02 | 17.56 | 17.44 | 144.13 |
| 5,000 | 400,000 | 246.09 | 1,625,418.95 | 21.04 | 20.29 | 148.28 |
| 10,000 | 400,000 | 254.38 | 1,572,441.39 | 25.36 | 23.85 | 160.80 |

Results vary by CPU, Node version, and runtime load; rerun locally to compare changes over time.

## Current limitations

- Classic payment operations only. Other operation types (path payments, offers, trustlines, account management, Soroban invocations) are in-progress — see open issues tagged [`core-engine`](https://github.com/orbital/orbital/labels/core-engine).
- In-process only. Horizontal scale and multi-region coordination belong in the deployment layer, not in core.
- Cursor starts at `now` on every run. Resume-from-cursor is tracked in [#OSS-CORE-017](#).

## License

MIT
