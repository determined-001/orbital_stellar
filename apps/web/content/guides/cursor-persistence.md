---
title: Cursor Persistence
description: Configure durable cursor stores for crash-resilient Stellar event streaming with @orbital-stellar/pulse-core.
---

## Overview

Durable cursors allow an `EventEngine` to resume a stream from the exact point it left off after a restart or crash. Without a cursor store, the engine defaults to `"now"`, which can lead to missed events during downtime.

`@orbital-stellar/pulse-core` ships four reference cursor store implementations plus two decorator utilities for write-coalescing and caching. This guide covers the `CursorStore` interface, available adapters, configuration patterns, and the kill-and-restart crash-resilience invariant.

## Quick Start

```ts
import { EventEngine, FileCursorStore } from "@orbital-stellar/pulse-core";

const store = new FileCursorStore("./cursors");
const engine = new EventEngine({
  network: "testnet",
  cursorStore: store,
  streamKey: "my-app",
});

engine.start();
```

That's it. On restart, `engine.start()` loads the saved cursor and resumes where it left off.

## The `CursorStore` Interface

Every cursor store implements this minimal contract:

```ts
abstract class CursorStore {
  abstract get(streamKey: string): Promise<string | null>;
  abstract set(streamKey: string, cursor: string): Promise<void>;

  // Optional batch operations — override for efficiency
  async getMany(keys: string[]): Promise<Record<string, string | null>>;
  async setMany(entries: Record<string, string>): Promise<void>;

  // Optional enumeration — used by migrateCursors
  async getAll(): Promise<Array<{ streamKey: string; cursor: string }>>;

  // Optional health check — used by engine.healthCheck()
  ping?(): Promise<void>;
}
```

Cursor values are opaque strings you should never parse or modify. Horizon cursors are paging tokens (e.g., `"1234567890-1"`). Soroban cursors are ledger-based composite strings. The store treats both as black boxes.

## Available Implementations

### MemoryCursorStore (Default)

Non-persistent in-memory Map. Useful for testing and prototyping.

```ts
import { MemoryCursorStore } from "@orbital-stellar/pulse-core";

const store = new MemoryCursorStore();
```

**Loss window:** 100%. Cursors are lost on process exit.

### FileCursorStore

Writes cursors to a local directory with atomic file writes and fsync for durability.

```ts
import { FileCursorStore } from "@orbital-stellar/pulse-core";

const store = new FileCursorStore("./cursors", logger);
```

Each stream key gets its own JSON file: `./cursors/{encoded-stream-key}.json`. Writes use a tmp-file-then-rename pattern to ensure atomic updates even during unclean shutdown.

**Loss window:** ~0 ms. Files are fsynced before the write returns.

**Best for:** Single-instance deployments, development, and self-hosted setups where a shared database is overkill.

### RedisCursorStore

Backed by any Redis-compatible client (`ioredis`, `node-redis`, etc.). Batch operations (`getMany` / `setMany`) use single-roundtrip `MGET` / `MSET` calls.

```ts
import { RedisCursorStore } from "@orbital-stellar/pulse-core";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
const store = new RedisCursorStore(redis);
```

**Minimal client interface** — any object with `get`, `set`, `mget`, `mset` methods works:

```ts
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  mset(...args: string[]): Promise<unknown>;
}
```

**Loss window:** Depends on Redis persistence (AOF / RDB). With `appendfsync everysec`, up to 1 second of cursor progress can be lost on Redis server crash.

**Best for:** Multi-instance deployments where process-level isolation is insufficient and you need shared cursor state across replicas.

### PostgresCursorStore

Strongly consistent cursor storage with upsert semantics. Recommended for active-active high-availability deployments.

```ts
import { PostgresCursorStore } from "@orbital-stellar/pulse-core";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PostgresCursorStore(pool);
```

**Setup:** Run the migration before first use:

```sql
-- migrations/001_cursor_store.sql
CREATE TABLE IF NOT EXISTS cursor_store (
    stream_key TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Loss window:** ~0 ms. Writes are durable after the transaction commits.

**Best for:** Production systems with multiple `EventEngine` instances reading the same addresses. Strong consistency prevents phantom reads and duplicate event processing.

### S3CursorStore

Eventually consistent cursor storage for low-cost, serverless deployments. Each cursor is a JSON object in S3.

```ts
import { S3CursorStore } from "@orbital-stellar/pulse-core";
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: "us-east-1" });
const store = new S3CursorStore(s3, "my-bucket", "cursors/");
```

**Minimal client interface:**

```ts
interface S3Like {
  getObject(params: { Bucket: string; Key: string }): Promise<{ Body: string | Uint8Array }>;
  putObject(params: { Bucket: string; Key: string; Body: string | Uint8Array }): Promise<void>;
}
```

**Loss window:** Variable. S3 is eventually consistent — recent writes may not be visible immediately on failover.

**Best for:** Active-passive failover deployments where only one instance writes at a time.

## Decorator Utilities

### coalesceCursorStore

Buffers writes in memory and flushes them in batches at a configurable interval. High-throughput engines call `set` after every processed event. Stores like Postgres and S3 charge per write, making per-event persistence expensive at scale.

```ts
import { coalesceCursorStore, PostgresCursorStore } from "@orbital-stellar/pulse-core";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const inner = new PostgresCursorStore(pool);
const store = coalesceCursorStore(inner, { intervalMs: 5_000 });

const engine = new EventEngine({ network: "testnet", cursorStore: store });
engine.start();

// On graceful shutdown, flush pending writes:
process.on("SIGTERM", async () => {
  await store.flush();
  store.dispose();
  engine.stop();
});
```

**Loss window:** Up to `intervalMs` milliseconds of cursor progress can be lost on unclean exit. Call `flush()` before shutdown to reduce the window to zero.

**How it works:**
- `set` returns immediately without touching the inner store
- Multiple `set` calls for the same key retain only the last value
- Every `intervalMs`, buffered entries are flushed via `setMany` in a single batch
- `get` checks the buffer first, then delegates to the inner store for cache misses

**Trade-off:** Lower write I/O and cost in exchange for a bounded replay window on crash.

### cacheCursorStore

Wraps any store with an in-memory TTL cache for reads. Useful when cursor reads happen frequently (e.g., during engine startup or health checks).

```ts
import { cacheCursorStore, RedisCursorStore } from "@orbital-stellar/pulse-core";

const inner = new RedisCursorStore(redis);
const store = cacheCursorStore(inner, { ttlMs: 30_000 });
```

- `get` returns cached value if still fresh, otherwise fetches from inner store and caches the result
- `set` invalidates the cached entry, then delegates to inner store
- `getAll` always delegates to inner store to keep enumeration transparent

## Kill-and-Restart Invariant

The crash-resilience guarantee: if a process is abruptly killed and restarted, the new instance resumes from the last durably persisted cursor with no duplicate or missing events.

### Test Scenario with FileCursorStore

```ts
import { EventEngine, FileCursorStore } from "@orbital-stellar/pulse-core";

const store = new FileCursorStore("./cursors");
const processed: string[] = [];

// First run: process 100 events
const engine1 = new EventEngine({
  network: "testnet",
  cursorStore: store,
  streamKey: "test-stream",
});

const watcher1 = engine1.subscribe("GABC...");
watcher1.on("*", (event) => {
  processed.push(event.id);
});

engine1.start();
// ... engine1 processes 100 events, then is killed (SIGKILL)

// Second run: restart with same store
const engine2 = new EventEngine({
  network: "testnet",
  cursorStore: store,
  streamKey: "test-stream",
});

const watcher2 = engine2.subscribe("GABC...");
watcher2.on("*", (event) => {
  processed.push(event.id);
});

engine2.start();
// ... engine2 resumes from event 101 (no duplicates, no gaps)
```

**What the engine does on startup:**

1. Call `cursorStore.get(streamKey)` before opening the stream
2. If a cursor is returned, pass it to Horizon/RPC as `?cursor=...`
3. If `null`, default to `"now"` and start from live ledger
4. After processing each event, call `cursorStore.set(streamKey, event.cursor)`

**FileCursorStore durability mechanics:**

- Every `set` writes to a temporary file with a random suffix: `{key}.json.tmp-abc123`
- After the write, the file descriptor is fsynced to ensure the data hits disk
- The temp file is renamed to the final path: `{key}.json`
- The directory is fsynced (best-effort) to make the rename durable

This pattern ensures that even if the process is killed mid-write, the previous cursor file remains intact and the incomplete write is discarded.

## Consistency Models

Different storage backends provide different consistency and durability guarantees. Choosing the right store depends on your deployment architecture.

| Store | Consistency | Best For |
|---|---|---|
| **Postgres** | Strong | Active-active (HA) deployments |
| **Redis** | Eventual (AOF/RDB dependent) | Multi-instance with shared state |
| **File** | Strong (local) | Single-instance / development |
| **S3** | Eventual | Active-passive failover |
| **Memory** | None (ephemeral) | Testing / prototyping |

### High Availability (Active-Active)

If you run multiple `EventEngine` instances for the same addresses (e.g., behind a load balancer or for redundancy), use a strongly consistent store like **Postgres**. This prevents duplicate event processing and phantom reads when instances disagree on the current cursor position.

```ts
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PostgresCursorStore(pool);

// Both instances share the same store
const engine1 = new EventEngine({ network: "testnet", cursorStore: store, streamKey: "app" });
const engine2 = new EventEngine({ network: "testnet", cursorStore: store, streamKey: "app" });
```

### Failover (Active-Passive)

If you run a primary and a standby instance where the standby only starts once the primary is confirmed dead, an eventually consistent store like **S3** is acceptable. The failover delay usually exceeds the consistency window.

### Single Instance

**FileCursorStore** is the simplest durable option for single-instance deployments. No external dependencies, no extra infrastructure cost.

## Soroban Cursor Expiry Edge Case

Soroban RPC nodes retain a limited history window (typically ~24 hours). If your cursor points to a ledger older than the node's oldest retained ledger, RPC returns an error:

```
startCursor is before oldest ledger
```

`@orbital-stellar/pulse-core` handles this automatically:

1. Catch the error and emit an `engine.cursor_expired` event
2. Fall back to the latest ledger and save it as the new cursor
3. Log a warning acknowledging data loss
4. Resume streaming from the new cursor

**What you lose:** All events between the expired cursor and the latest ledger. This can happen if:

- The engine is stopped for longer than the RPC retention window
- The RPC node is upgraded and its history is pruned

**Mitigation:**

- Monitor `engine.cursor_expired` events and alert on data loss
- Ensure your cursor store is flushed regularly (use `coalesceCursorStore` with a short `intervalMs`)
- Run the engine continuously or restart within the retention window

**Example:**

```ts
engine.on("engine.cursor_expired", (event) => {
  console.error(`[ALERT] Cursor expired for ${event.source}: ${event.lostCursor}`);
  // Forward to your monitoring system (Sentry, Datadog, PagerDuty)
});
```

## Migrating Between Stores

When moving from one cursor store to another (e.g., in-memory → Postgres at scale-up), use the built-in `migrateCursors` utility to copy all existing cursors with zero downtime.

```ts
import { migrateCursors, MemoryCursorStore, PostgresCursorStore } from "@orbital-stellar/pulse-core";
import pg from "pg";

const oldStore = new MemoryCursorStore();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const newStore = new PostgresCursorStore(pool);

const result = await migrateCursors(oldStore, newStore);
console.log(`Migrated ${result.migrated} cursor(s)`);
```

**Recommended sequence:**

1. Deploy the new store alongside the existing one (both must be reachable)
2. Run the migration **before** switching the engine config
3. Switch `EventEngine`'s `cursorStore` to point at the new store
4. Verify the engine resumes correctly
5. Remove the old store once healthy operation is confirmed

**Idempotency:** Running the migration multiple times is safe — it overwrites target entries with source values.

**Limitation:** The source store must implement `getAll()`. Not all stores support enumeration (e.g., `RedisCursorStore` without key scanning). Postgres, File, and Memory stores support `getAll` out of the box.

## Health Checks

If your cursor store implements the optional `ping()` method, `engine.healthCheck()` will verify cursor store connectivity as part of the overall health status.

```ts
const result = await engine.healthCheck();
if (!result.ok) {
  console.error("Health check failed:", result.reasons);
}
```

**Stores with `ping` support:**

- `PostgresCursorStore` — runs `SELECT 1`
- `RedisCursorStore` — runs `PING`

File and Memory stores don't expose `ping` because they have no network dependency to check.

## Custom Stores

To implement your own store (e.g., DynamoDB, MongoDB, Firestore), extend `CursorStore` and implement `get` and `set`:

```ts
import { CursorStore } from "@orbital-stellar/pulse-core";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

export class DynamoCursorStore extends CursorStore {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {
    super();
  }

  async get(streamKey: string): Promise<string | null> {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { streamKey: { S: streamKey } },
      }),
    );
    return result.Item?.cursor?.S ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          streamKey: { S: streamKey },
          cursor: { S: cursor },
          updatedAt: { S: new Date().toISOString() },
        },
      }),
    );
  }
}
```

Override `getMany` / `setMany` if your backend supports batch operations. Override `getAll` if you want `migrateCursors` support. Add `ping` for health check integration.

## Summary

| Store | Durability | Consistency | Best For |
|---|---|---|---|
| `MemoryCursorStore` | None | N/A | Testing / prototyping |
| `FileCursorStore` | Strong (fsync) | Strong (local) | Single-instance / development |
| `RedisCursorStore` | AOF/RDB dependent | Eventual | Multi-instance with shared state |
| `PostgresCursorStore` | Strong (txn commit) | Strong | Active-active HA |
| `S3CursorStore` | Strong (after PUT) | Eventual | Active-passive failover |

**Decorator utilities:**

- **`coalesceCursorStore`** — batch writes to reduce I/O cost (introduces bounded loss window)
- **`cacheCursorStore`** — cache reads to reduce latency (no loss window)

**Production recommendations:**

- Use `PostgresCursorStore` for active-active HA
- Use `FileCursorStore` for single-instance deployments
- Wrap high-throughput stores with `coalesceCursorStore` to reduce write I/O
- Call `flush()` before process exit to minimize loss window
- Monitor `engine.cursor_expired` events to detect Soroban history gaps
- Use `migrateCursors` for zero-downtime store transitions
