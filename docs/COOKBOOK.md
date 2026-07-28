# Orbital - Cookbook

> Copy-paste recipes. Each one is the smallest working snippet that
> demonstrates one capability. For narrative walkthroughs (full setups,
> deployment, hardening) see the guides at
> [`apps/web/content/guides/`](../apps/web/content/guides/).
>
> **Legend.** ✅ ships today and runs against testnet/mainnet.
> 🛠️ planned, tracked in [`ROADMAP.md`](../ROADMAP.md).

---

## Table of contents

1. [Watch an account for incoming payments](#1-watch-an-account-for-incoming-payments)
2. [Subscribe to multiple addresses with one engine](#2-subscribe-to-multiple-addresses-with-one-engine)
3. [Filter events with a predicate](#3-filter-events-with-a-predicate)
4. [Handle reconnection and rate-limit notifications](#4-handle-reconnection-and-rate-limit-notifications)
5. [Use a custom Horizon URL](#5-use-a-custom-horizon-url)
6. [Deliver events to an HTTPS endpoint](#6-deliver-events-to-an-https-endpoint)
7. [Verify a webhook in a Cloudflare Worker](#7-verify-a-webhook-in-a-cloudflare-worker)
8. [Fan out one event to multiple URLs](#8-fan-out-one-event-to-multiple-urls)
9. [Route `webhook.failed` to a dead-letter queue](#9-route-webhookfailed-to-a-dead-letter-queue)
10. [Capture an anchor audit trail](#10-capture-an-anchor-audit-trail)
11. [Render live payments in React with type narrowing](#11-render-live-payments-in-react-with-type-narrowing)
12. [Stand up an SSE endpoint in Next.js](#12-stand-up-an-sse-endpoint-in-nextjs)
13. [Subscribe to Soroban contract events](#13-subscribe-to-soroban-contract-events)
14. [Unit test webhooks with deterministic jitter](#14-unit-test-webhooks-with-deterministic-jitter)
15. [Generate TypeScript types from a Soroban contract](#15-generate-typescript-types-from-a-soroban-contract)
16. [Back up and restore cursor positions](#16-back-up-and-restore-cursor-positions)
17. [Inspect or replay dead-letter-queue entries](#17-inspect-or-replay-dead-letter-queue-entries)
18. [Subscribe to contract-specific typed events in React](#18-subscribe-to-contract-specific-typed-events-in-react)

---

## 1. Watch an account for incoming payments

The shortest path. Subscribe, attach a handler, wait for events. ✅

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...YOUR_ACCOUNT");

watcher.on("payment.received", (event) => {
  console.log(`+${event.amount} ${event.asset} from ${event.from}`);
});
```

Send a test payment from the [Stellar Laboratory](https://laboratory.stellar.org) and the event prints within seconds. `engine.stop()` cleanly closes the upstream connection - always call it in your shutdown path.

---

## 2. Subscribe to multiple addresses with one engine

One Horizon connection, many watchers. The engine fans events out internally - no extra network cost per subscriber. ✅

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const accounts = ["GABC...", "GDEF...", "GHIJ..."];

for (const address of accounts) {
  const watcher = engine.subscribe(address);
  watcher.on("*", (event) => {
    console.log(`[${address.slice(0, 8)}] ${event.type}`);
  });
}
```

`engine.subscribe()` is idempotent - calling it twice for the same address returns the same `Watcher`. To stop watching one account without tearing down the stream: `engine.unsubscribe(address)`. To stop watching everything: `engine.unsubscribeAll()`.

---

## 3. Filter events with a predicate

Pass a `filter` function on `subscribe()` to suppress events you don't want delivered. The filter runs before any `on(…)` handler fires. ✅

```ts
import { EventEngine, type NormalizedEvent } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...", {
  filter: (event: NormalizedEvent) =>
    event.type === "payment.received" &&
    Number(event.amount) >= 100, // ≥ 100 units, whatever the asset
});

watcher.on("payment.received", (event) => {
  console.log(`Large payment: ${event.amount} ${event.asset}`);
});
```

A predicate that throws is treated as `false` (suppress, with a warn log) - the engine never crashes on a bad filter.

---

## 4. Handle reconnection and rate-limit notifications

Lifecycle notifications surface alongside operation events on every watcher. Surface them as toasts, banners, or structured logs. ✅

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

watcher.on("engine.reconnecting", (n) => {
  console.warn(`Reconnect attempt ${n.attempt}, delay ${n.delayMs}ms`);
});

watcher.on("engine.rate_limited", (n) => {
  console.warn(`Horizon rate-limited us. Backing off ${n.delayMs}ms`);
});

watcher.on("engine.reconnected", (n) => {
  console.info(`Stream restored on attempt ${n.attempt}`);
});

watcher.on("engine.stopped", () => {
  console.info("Engine stopped");
});
```

The engine parses `Retry-After` headers on 429 responses and uses that exact delay (falling back to 60 s if the header is missing).

---

## 5. Use a custom Horizon URL

Self-hosted node, regional mirror, or futurenet. The `network` field still picks the chain context; `horizonUrl` overrides the HTTP target. ✅

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({
  network: "mainnet",
  horizonUrl: "https://horizon.your-node.example.com",
  reconnect: { initialDelayMs: 2000, maxDelayMs: 60_000 },
});

engine.start();
```

The URL must be `http://` or `https://`. The engine validates the URL at construction time and throws synchronously if it's malformed - you get a fast error, not a silent SSE failure.

---

## 6. Deliver events to an HTTPS endpoint

`WebhookDelivery` attaches to a watcher and POSTs every event to your endpoint with HMAC-SHA256 signing, exponential backoff retry, and a configurable per-attempt timeout. ✅

**Sender side** - attach delivery to the watcher:

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
  deliveryTimeoutMs: 10_000,
});
```

**Receiver side** - verify the signature and enforce the replay window with `maxAgeMs`:

```ts
import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";
import express from "express";

const app = express();

app.post(
  "/hooks/stellar",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.header("x-orbital-signature");
    const timestamp = req.header("x-orbital-timestamp");
    if (!signature || !timestamp) return res.sendStatus(400);

    const event = verifyWebhook(
      req.body.toString(),
      signature,
      process.env.WEBHOOK_SECRET!,
      timestamp,
      { maxAgeMs: 5 * 60 * 1000 }, // reject signatures older than 5 minutes
    );
    if (!event) return res.sendStatus(401);

    console.log(`Verified ${event.type}`);
    res.sendStatus(200);
  },
);
```

Each request carries `x-orbital-signature` (hex HMAC-SHA256 over `${timestamp}.${body}`), `x-orbital-timestamp`, and `x-orbital-attempt`. Always pass `maxAgeMs` to bound replay - a signature without a replay window is valid indefinitely. The default is `300_000` (5 minutes), matching the recommendation in `SECURITY.md`.

---

## 7. Verify a webhook in a Cloudflare Worker

`verifyWebhookEdge` uses Web Crypto, so it runs on Cloudflare Workers, Vercel Edge, Deno, and browsers - anywhere without Node's `crypto` module. ✅

```ts
import { verifyWebhookEdge } from "@orbital-stellar/pulse-webhooks";

export default {
  async fetch(request: Request, env: { WEBHOOK_SECRET: string }) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("x-orbital-signature");
    const timestamp = request.headers.get("x-orbital-timestamp");
    if (!signature || !timestamp) {
      return new Response("Missing headers", { status: 400 });
    }

    const payload = await request.text();
    const event = await verifyWebhookEdge(
      payload,
      signature,
      env.WEBHOOK_SECRET,
      timestamp,
      { maxAgeMs: 5 * 60 * 1000 }, // reject signatures older than 5 minutes
    );
    if (!event) return new Response("Invalid signature", { status: 401 });

    // event is a verified, typed NormalizedEvent
    console.log(`Verified ${event.type}`);
    return new Response("ok");
  },
};
```

The verifier returns `null` on any failure (bad signature, malformed timestamp, bad JSON) - fail closed, never assume success.

---

## 8. Fan out one event to multiple URLs

`WebhookDelivery.config.url` accepts an array. Each URL retries independently - one slow endpoint does not block delivery to the others. ✅

```ts
new WebhookDelivery(watcher, {
  url: [
    "https://primary.your-app.com/hooks/stellar",
    "https://staging.your-app.com/hooks/stellar",
    "https://analytics.your-app.com/hooks/stellar",
  ],
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
});
```

The `webhook.failed` event (see recipe 9) fires per-URL, so you can detect which endpoint is sick and route accordingly.

---

## 9. Route `webhook.failed` to a dead-letter queue

When a delivery exhausts its retries, the watcher emits `webhook.failed` with the original event in `raw.originalEvent` and the failed URL in `raw.url`. Catch it and persist to a DLQ. ✅

```ts
import { EventEngine, type NormalizedEvent } from "@orbital-stellar/pulse-core";
import { WebhookDelivery, type WebhookFailureRaw } from "@orbital-stellar/pulse-webhooks";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://flaky.your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
});

watcher.on("webhook.failed", async (event) => {
  const { url, error, attempts, originalEvent } = event.raw as WebhookFailureRaw;
  await persistToDLQ({
    url,
    error,
    attempts,
    event: originalEvent,
    failedAt: new Date().toISOString(),
  });
});

declare function persistToDLQ(record: unknown): Promise<void>;
```

`webhook.dropped` fires when the concurrent-retry cap evicts a pending retry - handle it the same way if you care about every miss.

---

## 10. Capture an anchor audit trail

Compose `CursorStore` + `RetryQueue` + `DeadLetterStore` to capture payment and trustline events for a set of anchor distribution accounts into an append-only audit log. The result is replay-safe: `replay --from <cursor>` rebuilds the audit log byte-identically from any point. ✅

```ts
import { EventEngine, FileCursorStore, type NormalizedEvent } from "@orbital-stellar/pulse-core";
import { MemoryRetryQueue, MemoryDeadLetterStore } from "@orbital-stellar/pulse-webhooks";
import { createWriteStream } from "fs";

// 1. Durable cursor store: survives process restarts.
const cursorStore = new FileCursorStore("./.orbital-cursors");

// 2. Retry queue: backs webhook delivery retries (swap for RedisRetryQueue in
//    production so retries survive restarts).
const retryQueue = new MemoryRetryQueue();

// 3. Dead-letter store: terminal failure persistence (swap for
//    PostgresDeadLetterStore in production for durability).
const deadLetter = new MemoryDeadLetterStore();

const engine = new EventEngine({
  network: "testnet",
  cursorStore,
  streamKey: "anchor-audit",
});
engine.start();

// Anchor distribution accounts to monitor.
const accounts = ["GABC...", "GDEF..."];

// Append-only audit log (JSON Lines, sorted keys for deterministic output).
const auditLog = createWriteStream("./audit.jsonl", { flags: "a" });

for (const account of accounts) {
  const watcher = engine.subscribe(account, {
    filter: (event: NormalizedEvent): boolean =>
      event.type === "payment.received" ||
      event.type === "payment.sent" ||
      event.type === "trustline.added" ||
      event.type === "trustline.removed",
  });

  watcher.on("*", (event) => {
    const raw = event.raw as Record<string, unknown> | undefined;
    const [ledgerStr, opIdxStr] = (raw?.id as string ?? "0-0").split("-");

    const record = {
      ledger: parseInt(ledgerStr, 10),
      txHash: extractTxHash(raw),
      operationIndex: parseInt(opIdxStr, 10),
      memo: (raw?.memo as string) ?? null,
      asset: event.asset,
      from: "from" in event ? event.from : event.account,
      to: "to" in event ? event.to : event.asset.split(":")[1] ?? "",
      eventType: event.type,
      timestamp: event.timestamp,
      raw: event.raw,
    };

    // Stable JSON: sorted keys for byte-identical replay.
    auditLog.write(JSON.stringify(record, sortedKeys) + "\n");
  });
}

function extractTxHash(raw?: Record<string, unknown>): string {
  const links = raw?._links as Record<string, unknown> | undefined;
  const txHref = links?.transaction as Record<string, unknown> | undefined;
  if (typeof txHref?.href === "string") {
    return txHref.href.split("/").pop() ?? "";
  }
  return "";
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

// Graceful shutdown.
process.on("SIGTERM", () => { auditLog.end(); engine.stop(); });
```

**Delivery guarantee: at-least-once with idempotency keys.** The composition of `CursorStore` + `RetryQueue` + `DeadLetterStore` provides at-least-once semantics, not exactly-once. Consumers MUST deduplicate by `(ledger, operationIndex)`. A process restart between event capture and cursor flush WILL produce duplicates on restart. For a full, production-shape `AnchorService` class that wraps this composition (with CLI and replay support), see [`examples/anchor-starter/`](../examples/anchor-starter/).

---

## 11. Render live payments in React with type narrowing

`useStellarEvent<T>` is generic - pass a narrow union as `T` to get full autocomplete and exhaustive `switch` checking. ✅

```tsx
"use client";
import { useStellarEvent } from "@orbital-stellar/pulse-notify";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

type WalletEvents = Extract<
  NormalizedEvent,
  { type: "payment.received" | "payment.sent" | "trustline.added" }
>;

export function Wallet({ address }: { address: string }) {
  const { event, connected, error } = useStellarEvent<WalletEvents>(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
    { event: ["payment.received", "payment.sent", "trustline.added"] },
  );

  if (error) return <p className="text-red-500">{error}</p>;
  if (!connected) return <p>Connecting…</p>;
  if (!event) return <p>Listening…</p>;

  switch (event.type) {
    case "payment.received":
      return <p>+{event.amount} {event.asset} from {event.from.slice(0, 8)}…</p>;
    case "payment.sent":
      return <p>−{event.amount} {event.asset} to {event.to.slice(0, 8)}…</p>;
    case "trustline.added":
      return <p>Added trustline for {event.asset}</p>;
  }
}
```

A `switch` over `event.type` with no `default` clause will produce a TypeScript error if you ever miss a case - the narrow union does the work.

---

## 12. Stand up an SSE endpoint in Next.js

The hooks expect a backend that re-emits Orbital events as Server-Sent Events. The marketing site ships a working reference at `apps/web/app/api/events/[address]/route.ts` - copy it, strip the demo limits in `apps/web/lib/demo-limits.ts`, and you have your production SSE handler. ✅

```ts
// app/api/events/[address]/route.ts
import { EventEngine } from "@orbital-stellar/pulse-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const g = globalThis as unknown as { __engine?: EventEngine };
function engine() {
  if (!g.__engine) {
    g.__engine = new EventEngine({ network: "mainnet" });
    g.__engine.start();
  }
  return g.__engine;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const watcher = engine().subscribe(address);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const beat = setInterval(
        () => controller.enqueue(encoder.encode(`: heartbeat\n\n`)),
        30_000,
      );
      watcher.on("*", send);
      req.signal.addEventListener("abort", () => {
        clearInterval(beat);
        watcher.removeListener("*", send);
        engine().unsubscribe(address);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

The `globalThis` trick keeps one `EventEngine` alive across Next.js HMR. In production (`next start`) it persists for the lifetime of the Node process. On Vercel serverless, expect periodic reconnects when the function instance recycles - fine for demos, not for production Cloud.

---

## 13. Subscribe to Soroban contract events

Subscribes to smart-contract events by contract ID and topic filter via Stellar RPC. Same normalized-event taxonomy as classic operations, with two new types: `contract.invoked` and `contract.emitted`.

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({
  network: "mainnet",
  soroban: {
    rpcUrl: "https://soroban-rpc.your-node.example.com",
  },
});
engine.start();

const watcher = engine.subscribeContract({
  contractId: "CA...",
  topics: ["transfer"], // optional topic filter
});

watcher.on("contract.emitted", (event) => {
  console.log(event.contractId, event.topic, event.decodedData);
});
```

Decoding to typed `decodedData` requires the ABI Registry client (`@orbital-stellar/abi-registry`), wired in via `EventEngine`'s ABI registry config - see [`packages/abi-registry/README.md`](../packages/abi-registry/README.md). Without a registered ABI, raw XDR is exposed in `event.raw`.

---

## 14. Unit test webhooks with deterministic jitter

Inject a custom RNG into `WebhookDelivery` to make exponential backoff delays deterministic in your test suite. ✅

```ts
import { Watcher } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";
import { vi } from "vitest";

// A simple seeded RNG for deterministic results
let seed = 12345;
const seededRandom = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const watcher = new Watcher("GABC...");

new WebhookDelivery(watcher, {
  url: "https://example.com/webhook",
  secret: "top-secret",
  retries: 3,
  random: seededRandom, // 👈 Inject RNG here
});
```

Combine this with `vi.useFakeTimers()` to verify that retries happen after the exact jittered delay you expect without waiting for real-world wall clock time.

---

## 15. Generate TypeScript types from a Soroban contract

Generate TypeScript type declarations and Zod schemas from a deployed Soroban contract's spec. ✅

### Using the CLI

```bash
# Generate types from a testnet contract
orbital typegen CBCG...YOUR_CONTRACT --out src/contract-types.ts

# Target mainnet with a custom RPC endpoint
orbital typegen CBCG...YOUR_CONTRACT \
  --network mainnet \
  --rpc-url https://soroban-mainnet.example.com \
  --out src/contract-types.ts
```

### Using the binary directly (standalone generate)

```bash
# If you already have a contract spec JSON file
abi-registry-generate ./my-contract-spec.json ./my-contract.d.ts
```

The `abi-registry-generate` binary takes a Soroban contract spec JSON file and outputs a `.d.ts` file with generated TypeScript types. It ships with `@orbital-stellar/abi-registry` and is available via `npx abi-registry-generate`.

---

## 16. Back up and restore cursor positions

Dump or restore cursor positions from a Postgres database for migration or disaster recovery. Requires the `pg` package installed separately. ✅

```bash
# Install the pg driver (if not already available)
npm install pg

# Dump all cursors as line-delimited JSON to a file
orbital cursor dump > cursors-backup.jsonl

# Restore cursors from the backup file
orbital cursor restore < cursors-backup.jsonl
```

The `cursor dump` command reads from the `cursor_store` table and outputs one JSON object per line. `cursor restore` reads the same format from stdin and writes back. Both commands connect to Postgres via the `PG*` environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, etc.) — the same ones `psql` uses.

---

## 17. Inspect or replay dead-letter-queue entries

When webhook deliveries fail after all retries, entries land in the dead-letter queue (DLQ). The `orbital-dlq` CLI lets you list, dump, and replay them. ✅

```bash
# List all DLQ entries for a specific URL
orbital-dlq dlq list --url https://your-app.com/hooks/stellar

# Filter entries since a timestamp with a limit
orbital-dlq dlq list \
  --url https://your-app.com/hooks/stellar \
  --since 2026-01-01T00:00:00Z \
  --limit 50

# Dump all DLQ entries as line-delimited JSON
orbital-dlq dlq dump

# Replay a specific DLQ entry (re-signs and re-delivers)
orbital-dlq dlq replay <entry-id> --secret "$WEBHOOK_SECRET"
```

The `orbital-dlq` binary ships with `@orbital-stellar/pulse-webhooks` and is available via `npx orbital-dlq`. Set `ORBITAL_WEBHOOK_SECRET` in your environment or pass `--secret` to re-sign replayed deliveries.

---

## 18. Subscribe to contract-specific typed events in React

Use `orbital codegen` with a contract spec to generate per-event React hooks with
Zod runtime validation, then consume them in your components. ✅

**Step 1: Generate types and hooks from a registry spec**

```ts
import { generateContractArtifacts, generateContractHooks } from "@orbital-stellar/abi-registry";
import type { ContractSpec } from "@orbital-stellar/abi-registry";

// Load the spec - from a registry client, local file, or WASM discovery
const spec: ContractSpec = { /* ... contract spec ... */ };

const artifacts = generateContractArtifacts(spec);
// artifacts.declarations  → TypeScript interfaces + types
// artifacts.schemas        → Zod validation schemas
// artifacts.hooks          → React hook wrappers (e.g. useSwapExecuted)

// Or use the standalone hook generator:
const hooks = generateContractHooks(spec);
```

**Step 2: Use generated hooks in a React component**

```tsx
import { useContractEvent } from "@orbital-stellar/pulse-notify";
import { SwapExecutedEventSchema } from "./generated/MyContract";

function SwapActivity({ serverUrl, contractId }: { serverUrl: string; contractId: string }) {
  const { event, connected, error } = useContractEvent({
    serverUrl,
    contractId,
    topics: ["swap_executed"],
    schema: SwapExecutedEventSchema, // Zod validation
  });

  if (error) return <div>Error: {error}</div>;
  if (!connected) return <div>Connecting...</div>;
  if (!event) return <div>Waiting for swap events...</div>;

  // event.data is now validated and typed
  return (
    <div>
      <p>Swap executed: {JSON.stringify(event.data)}</p>
      <p>Ledger: {event.ledger}</p>
    </div>
  );
}
```

**Step 3: Use auto-generated hook wrappers (from `orbital codegen`)**

For contracts with registered schemas, `orbital codegen` emits named hooks
like `useSwapExecuted()` that wrap `useContractEvent` with the correct
Zod schema pre-applied:

```tsx
import { useSwapExecuted } from "@orbital-stellar/generated/MyContract";

function SwapWatcher({ serverUrl, contractId }: { serverUrl: string; contractId: string }) {
  const { event, connected } = useSwapExecuted({ serverUrl, contractId });

  if (event) {
    // event is typed as the SwapExecutedEvent interface
    return <div>Swapped at ledger {event.ledger}: {event.data.amount}</div>;
  }
  return <div>Watching for swaps...</div>;
}
```

**Connection lifecycle:**
- One SSE connection is shared per `(contractId, topics)` regardless of how
  many hook instances mount it - asserted by the test suite.
- When all hook instances unmount, the connection closes and the subscription
  count returns to zero.

---

## Related documents

- [`apps/web/content/guides/`](../apps/web/content/guides/) - narrative walkthroughs (real-time events, webhooks)
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) - system diagrams, lifecycle, trust boundaries
- [`packages/pulse-core/README.md`](../packages/pulse-core/README.md) - full API reference
- [`packages/pulse-webhooks/README.md`](../packages/pulse-webhooks/README.md) - delivery contract, security
- [`packages/pulse-notify/README.md`](../packages/pulse-notify/README.md) - React hook reference
