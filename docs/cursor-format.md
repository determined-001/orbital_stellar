# Cursor Management

Durable cursors allow an `EventEngine` to resume a stream from the exact point it left off after a restart or crash. Without a cursor store, the engine defaults to `"now"`, which can lead to missed events during downtime.

## Cursor Format

A cursor is an opaque string representing a position in the Stellar ledger history.

- **Horizon (Classic)**: Cursors are paging tokens (e.g., `"1234567890-1"`).
- **Soroban (Contract Events)**: Cursors are composed of ledger sequence, entry index, and event type.

The `CursorStore` interface treats these as opaque strings. You should never attempt to parse or modify a cursor string manually.

## Consistency Model

Different storage backends provide different consistency and durability guarantees. Choosing the right store depends on your deployment architecture.

### Postgres (`PostgresCursorStore`)

- **Consistency**: Strong.
- **Guarantee**: Write-after-read consistency is guaranteed by the database transaction and row-level locking (upsert).
- **Deployment**: **Recommended for active-active (high availability) deployments.** 
- **Details**: Multiple instances of Orbital can safely coordinate via a shared Postgres instance. The strong consistency ensures that if one instance crashes and another takes over, it will always see the latest written cursor.

### S3 (Planned)

- **Consistency**: Eventual.
- **Guarantee**: S3 provides read-after-write consistency for new objects but eventual consistency for updates in some regions/conditions (though modern S3 is mostly strongly consistent, the latency can lead to race conditions in high-concurrency handoffs).
- **Deployment**: **Recommended for active-passive (failover) deployments only.**
- **Details**: In an active-passive setup, only one engine is writing to the cursor at a time. During a failover, there is a small window where the passive instance might read a slightly stale cursor if the active instance just updated it.

### In-Memory (Default)

- **Consistency**: None (Lossy).
- **Guarantee**: None.
- **Deployment**: **Development and testing only.**
- **Details**: Cursors are lost on process restart. Use this only when event gaps are acceptable.

## Summary Table

| Store | Consistency Model | Deployment Recommendation | Best For |
|---|---|---|---|
| **Postgres** | Strong | Active-Active | Production / High Availability |
| **S3** | Eventual | Active-Passive Only | Low-cost / Failover |
| **In-Memory** | N/A | Local Development | Testing / Prototyping |

## Deployment Recommendations

### High Availability (Active-Active)

If you run multiple instances of `EventEngine` for the same set of addresses (e.g., behind a load balancer or for redundancy), you **must** use a strongly consistent store like **Postgres**. This prevents "phantom reads" and duplicate event processing that can occur if two instances disagree on the current cursor position.

### Failover (Active-Passive)

If you run a primary and a standby instance, where the standby only starts once the primary is confirmed dead, an eventually consistent store like **S3** is acceptable. The failover delay usually exceeds the consistency window of the storage provider.

## Live Migration Between Stores

When moving from one cursor store to another (e.g., in-memory → Postgres at scale-up), use the built-in `migrateCursors` utility to copy all existing cursors with zero downtime.

### Recommended sequence

1. **Deploy the new store** alongside the existing one (both must be reachable).
2. **Run the migration** before switching the engine config:
   ```ts
   import { migrateCursors } from "@pulse-core";

   const result = await migrateCursors(oldStore, newStore);
   console.log(`Migrated ${result.migrated} cursor(s)`);
   ```
3. **Switch the `EventEngine` config** to point `cursorStore` at the new store.
4. **Remove the old store** once the engine has confirmed healthy operation on the new store.

### Idempotency

The migration is **idempotent** — running it multiple times overwrites the target entries with the same source values. This lets you retry the migration safely if it is interrupted.
