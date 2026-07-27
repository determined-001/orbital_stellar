# orbital-anchor-starter

Audit-grade, replay-safe event capture for Stellar anchors.

Captures **payment** and **trustline** events for a set of anchor distribution
accounts into an **append-only audit log** (JSON Lines). Composes
`CursorStore` + `RetryQueue` + `DeadLetterStore` from the Orbital SDK into a
single production-shaped pipeline that a compliance auditor can replay and
verify.

## Quick start

```bash
# Clone and install
git clone https://github.com/determined-001/orbital-anchor-starter.git
cd orbital-anchor-starter
pnpm install
pnpm build

# Capture events for your anchor distribution accounts
node dist/index.js \
  --accounts GABC...,GDEF... \
  --audit-log ./audit.jsonl \
  --network testnet
```

Press `Ctrl+C` to stop. The audit log is flushed to disk on every record.

## Replay

Rebuild the audit log byte-identically from any cursor:

```bash
node dist/index.js replay \
  --from "1234567890123456789-0" \
  --accounts GABC...,GDEF... \
  --audit-log ./audit.jsonl \
  --output ./audit-replay.jsonl
```

The replay output is byte-identical to the original run from that cursor
forward because:

1. Horizon returns the same ledger data in the same order for a given cursor
   range, and
2. Audit records are serialized with **sorted keys** for deterministic JSON
   output.

## Audit record format

Every line in the audit log is a JSON object with these fields:

| Field             | Type             | Description                                     |
|-------------------|------------------|-------------------------------------------------|
| `ledger`          | `number`         | Ledger sequence number                          |
| `txHash`          | `string`         | Transaction hash (hex)                          |
| `operationIndex`  | `number`         | Zero-based operation index within transaction   |
| `memo`            | `string \| null` | Transaction memo, or null if absent             |
| `asset`           | `string`         | Asset code (e.g. `"USDC:GABC..."` or `"XLM"`)   |
| `from`            | `string`         | Source account (sender or trustor)              |
| `to`              | `string`         | Destination account (receiver or issuer)        |
| `eventType`       | `string`         | Normalized event type                           |
| `timestamp`       | `string`         | ISO 8601 timestamp of ledger close time         |
| `raw`             | `object`         | Full raw Horizon operation record               |

Example:

```json
{"asset":"XLM","eventType":"payment.sent","from":"GABC...","ledger":5432100,"memo":"inv-42","operationIndex":1,"raw":{...},"timestamp":"2026-07-27T12:34:56Z","to":"GDEF...","txHash":"abc123..."}
```

## Delivery guarantee

### At-least-once with idempotency keys

This service provides **at-least-once** delivery. An event may appear more
than once in the audit log when:

- The engine reconnects mid-ledger and Horizon replays a window of events, or
- The process restarts before the cursor is flushed to disk.

Consumers MUST deduplicate by the composite key `(ledger, operationIndex)` or,
when forwarding to a webhook receiver, by the `x-orbital-delivery-id` header.

### NOT exactly-once

Exactly-once delivery requires a transactional outbox - writing the event and
advancing the cursor in a single atomic operation. The primitives composed
here (`CursorStore` + `RetryQueue` + `DeadLetterStore`) do not provide that
guarantee. If your compliance regime requires exactly-once, you must layer a
deduplication store on top of the audit log.

### Honest caveats

- **Process restarts.** The `FileCursorStore` writes cursors atomically (write
  to temp file, fsync, rename), but a crash between event delivery and cursor
  flush WILL cause at-least-once duplicates on restart.
- **Network partitions.** If Horizon is unreachable for longer than the cursor
  TTL, the stream may reset to the latest ledger. The `engine.cursor_expired`
  notification fires in this case - catch it and alert.
- **In-memory retry.** The default `MemoryRetryQueue` does not survive process
  restarts. Swap to `RedisRetryQueue` for durable retries.
- **In-memory dead-letter.** The default `MemoryDeadLetterStore` does not
  survive process restarts. Swap to `PostgresDeadLetterStore` for durable DLQ.

## Architecture

```
┌──────────────────────────────────────────┐
│              AnchorService               │
│                                          │
│  ┌──────────┐  ┌──────────────┐         │
│  │EventEngine│  │FileCursorStore│        │
│  │ (Horizon) │──│ (durable pos) │        │
│  └─────┬────┘  └──────────────┘         │
│        │ normalize                       │
│        ▼                                 │
│  ┌──────────┐                            │
│  │  filter   │ payment + trustline only  │
│  └─────┬────┘                            │
│        │                                 │
│        ▼                                 │
│  ┌──────────┐  ┌──────────────────────┐ │
│  │AuditLog  │  │MemoryDeadLetterStore │ │
│  │Writer    │  │(terminal failures)   │ │
│  └─────┬────┘  └──────────────────────┘ │
│        │                                 │
│        ▼                                 │
│  ┌──────────┐                            │
│  │ audit.jsonl│  append-only JSON Lines  │
│  └──────────┘                            │
│                                          │
│  ┌──────────────┐                        │
│  │MemoryRetryQueue│  (if webhook mode)   │
│  └──────────────┘                        │
└──────────────────────────────────────────┘
```

## Production hardening

For production use, swap the in-memory stores for durable backends:

```ts
import { RedisRetryQueue, PostgresDeadLetterStore } from "@orbital-stellar/pulse-webhooks";
import { PostgresCursorStore } from "@orbital-stellar/pulse-core";

// Durable cursor store
const cursorStore = new PostgresCursorStore(pool);

// Durable retry queue (survives restarts)
const retryQueue = new RedisRetryQueue({ client: redis });

// Durable dead-letter store (audit trail for terminal failures)
const deadLetter = new PostgresDeadLetterStore(pool);
```

Then compose them with `EventEngine` and `WebhookDelivery` from the SDK.

## Related

- [Orbital SDK documentation](https://github.com/determined-001/orbital_stellar)
- [COOKBOOK.md - Anchor audit trail recipe](https://github.com/determined-001/orbital_stellar/blob/main/docs/COOKBOOK.md#10-anchor-audit-trail)
- [ARCHITECTURE.md](https://github.com/determined-001/orbital_stellar/blob/main/docs/ARCHITECTURE.md)
