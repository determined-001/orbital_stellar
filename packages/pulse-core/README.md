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
| `config.horizonUrl` | `string` | Override the Horizon server URL (e.g. private node, regional mirror, futurenet). When set, `network` is still used for chain context but the connection is made to this URL |
| `config.reconnect.initialDelayMs` | `number` | First retry delay (default `1000`) |
| `config.reconnect.maxDelayMs` | `number` | Backoff ceiling (default `30_000`) |
| `config.reconnect.maxRetries` | `number` | Retry budget (default `Infinity`) |

### `engine.start()` / `engine.stop()`

Open or close the SSE stream. Idempotent — calling `start()` twice logs a warning and returns.

### `engine.subscribe(address)` → `Watcher`

Returns a `Watcher` for the given Stellar public key. Watchers are deduplicated — calling `subscribe` twice with the same address returns the same instance.

Once a watcher has been stopped, it will not accept new listeners. Calling `watcher.on(...)` after `watcher.stop()` logs a warning and leaves the listener unregistered. If you construct a watcher directly with `{ strictStoppedListeners: true }`, the same call throws instead.

### `engine.unsubscribe(address)`

Stops and removes the watcher for the given address.

### Network passphrases and asset format

`pulse-core` exports `NETWORK_PASSPHRASES` as the source of truth for the supported Stellar network passphrases:

```ts
import { NETWORK_PASSPHRASES } from "@orbital/pulse-core";

NETWORK_PASSPHRASES.mainnet; // "Public Global Stellar Network ; September 2015"
NETWORK_PASSPHRASES.testnet; // "Test SDF Network ; September 2015"
```

Use these constants in tests, signing helpers, or Stellar RPC calls that need the exact network passphrase for the same `network` value passed to `EventEngine`.

Normalized asset strings follow one rule across every event payload:

- Native XLM is emitted as `XLM`.
- Issued assets are emitted as `CODE:ISSUER`, for example `USDC:G...`.

### `Watcher` events

| Event | Payload | Fired when |
|---|---|---|
| `payment.received` | `NormalizedEvent` | The address is the recipient of a payment |
| `payment.sent` | `NormalizedEvent` | The address is the sender of a payment |
| `payment.self` | `NormalizedEvent` | The address is both sender and recipient of a payment |
| `*` | `NormalizedEvent` | Any event on this address |
| `engine.reconnecting` | `WatcherNotification` | The engine is retrying its upstream connection |
| `engine.reconnected` | `WatcherNotification` | Reconnect succeeded |
| `engine.rate_limited` | `WatcherNotification` | The engine was rate limited and will retry after the delay |
| `engine.stopped` | `WatcherNotification` | `engine.stop()` was called; emitted before watchers are torn down |
| `engine.cursor_expired` | `WatcherNotification` | The ingestion stream cursor has expired or is no longer valid, requiring a reset |
| `webhook.failed` | `NormalizedEvent` | All delivery attempts to a webhook URL have failed (emitted by `pulse-webhooks`) |
| `webhook.dropped` | `NormalizedEvent` | A pending webhook retry is dropped because the concurrency cap is reached (emitted by `pulse-webhooks`) |

> [!NOTE]
> Webhook events (`webhook.failed` and `webhook.dropped`) are emitted on the `Watcher` by the [`@orbital/pulse-webhooks`](../pulse-webhooks/README.md) package when attached. For these events, the `NormalizedEvent`'s `raw` field is populated with specialized metadata objects (`WebhookFailureRaw` and `WebhookDroppedRaw`, respectively). See the [Failure events section of `@orbital/pulse-webhooks`](../pulse-webhooks/README.md#failure-events) for detailed documentation and payload schemas.

> [!NOTE]
> For `engine.cursor_expired` notifications, the `WatcherNotification` payload includes additional fields:
> - `lostCursor`: `string` — The value of the cursor that expired.
> - `source`: `"horizon" | "soroban"` — The subscription engine source where the expiry occurred.


### `NormalizedEvent` shape

`NormalizedEvent` is a discriminated union covering 21 event types across the full classic operation taxonomy (payments, accounts, trustlines, offers, claimables, liquidity pools, data entries, trust auth). Switch on `event.type` for full TypeScript narrowing per branch.

```ts
type NormalizedEvent =
  | PaymentEvent             // payment.received | payment.sent | payment.self
  | AccountCreatedEvent      // account.created
  | AccountMergeEvent        // account.merged
  | AccountOptionsEvent      // account.options_changed
  | BumpSequenceEvent        // account.bump_sequence
  | TrustlineEvent           // trustline.added | .updated | .removed
  | TrustAuthEvent           // trustline.authorized | .deauthorized
  | OfferEvent               // offer.created | .updated | .deleted
  | ClaimableCreatedEvent    // claimable.created
  | ClaimableClaimedEvent    // claimable.claimed
  | LiquidityPoolDepositEvent  // lp.deposited
  | LiquidityPoolWithdrawEvent // lp.withdrawn
  | DataEvent;               // data.set | data.cleared
```

Every event includes a `timestamp` (ISO 8601) and a `raw` field with the original Horizon record. See [`docs/ARCHITECTURE.md` § 4 The normalization layer](../../docs/ARCHITECTURE.md#4-the-normalization-layer) for the full per-event shape table and the routing rules that decide which watcher receives which event.

### Type narrowing with `isEventType`

Use the `isEventType` helper to narrow events to specific types in a type-safe way:

```ts
import { EventEngine, isEventType } from "@orbital/pulse-core";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

// Narrow to a single type
watcher.on("*", (event) => {
  if (isEventType(event, "payment.received")) {
    console.log(`Received ${event.amount} ${event.asset} from ${event.from}`);
  }
});

// Narrow to multiple types
watcher.on("*", (event) => {
  if (isEventType(event, "payment.received", "payment.sent", "payment.self")) {
    console.log(`Payment of ${event.amount} ${event.asset}`);
  }
});

// Filter an array of events
const allEvents: NormalizedEvent[] = [];
const paymentEvents = allEvents.filter((e) =>
  isEventType(e, "payment.received", "payment.sent", "payment.self")
);

// Combine with other checks
watcher.on("*", (event) => {
  if (isEventType(event, "trustline.added", "trustline.updated")) {
    console.log(`Trustline for ${event.asset} on account ${event.account}`);
  }
});
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

### Soroban Benchmark

Soroban contract event subscription has a matching replay benchmark at `bench/soroban-throughput.ts`.

Run it with:

```bash
pnpm --filter @orbital/pulse-core exec node --expose-gc --import tsx bench/soroban-throughput.ts
```

The harness subscribes `N` contract watchers with exact `contractIds` filters, synthesizes `getEvents` responses, and replays each RPC event through the engine's normalize + route + emit path. Use `--responses=100 --events-per-response=100` to scale the replay size.

#### Baseline numbers (Node v24.12.0, 10 responses x 100 events)

| Contract subscriptions (`N`) | RPC events | Routed events | Duration (ms) | Events/sec | Subscribed heap (MB) | Post-replay heap (MB) | Post-replay RSS (MB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 1,000 | 2,000 | 473.32 | 4,225.49 | 18.80 | 18.79 | 122.21 |
| 5,000 | 1,000 | 2,000 | 2,362.72 | 846.48 | 23.19 | 22.56 | 127.73 |
| 10,000 | 1,000 | 2,000 | 5,290.83 | 378.01 | 28.56 | 27.30 | 130.18 |

Each matching contract subscription receives both the typed event and the `*` wildcard event. Results vary by CPU, Node version, and runtime load; rerun locally to compare changes over time.

## Current limitations

- **Soroban subscription is still Phase 1 work.** Contract event normalization and in-process routing are present, with RPC handoff and restart resiliency covered by tests. Production cursor persistence and broader RPC integration continue under Phase 1 (`v1.0`, Q2–Q3 2026). Open issues tracked under [`core-engine`](https://github.com/determined-001/orbital_stellar/labels/core-engine).
- **In-process only.** Horizontal scale and multi-region coordination belong in the deployment layer, not in the SDK. See [`docs/open-source-policy.md`](../../docs/open-source-policy.md) for the public/private boundary.
- **Cursor starts at `now` on every run.** Resume-from-cursor with pluggable adapters ships in Phase 1 — see [`ROADMAP.md`](../../ROADMAP.md#wave-13--cursor-persistence-and-replay-primitives).

## Related documents

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — system diagrams, lifecycle sequence, reconnection state machine, trust boundaries
- [`docs/COOKBOOK.md`](../../docs/COOKBOOK.md) — copy-paste recipes for the most common patterns
- [`docs/open-source-policy.md`](../../docs/open-source-policy.md) — what stays MIT, what becomes Cloud
- [`CHANGELOG.md`](../../CHANGELOG.md) — release notes
- [`SECURITY.md`](../../SECURITY.md) — threat model and vulnerability reporting

## License

MIT
