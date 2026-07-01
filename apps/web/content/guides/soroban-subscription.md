---
title: Soroban Event Subscription
description: Subscribe to Soroban smart-contract events with engine.subscribeContract, ContractFilter, and the contract.emitted / contract.invoked event shapes.
---

Orbital's Phase 1 adds native Soroban support. `EventEngine` polls the Soroban RPC for contract events and delivers them to your watchers as strongly-typed `contract.emitted` and `contract.invoked` events.

## Setup

Enable Soroban by adding a `soroban` block to `CoreConfig`:

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({
  network: "testnet",
  soroban: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    pollIntervalMs: 2000,        // default — poll every 2 s
    startLedgerLookback: 0,      // default — start from the latest ledger
    pageLimit: 100,              // default — events per getEvents call (max 10,000)
  },
});

engine.start();
```

`engine.stop()` shuts down both the Horizon stream and the Soroban poll loop.

---

## `subscribeContract`

There are two call forms.

### Simple — subscribe by ID

Pass a subscription ID and an optional filter list:

```ts
const watcher = engine.subscribeContract("my-token", {
  filters: [
    { contractIds: ["CAAAA...CONTRACT_ID"] },
  ],
});

watcher.on("contract.emitted", (event) => {
  console.log(event.contractId, event.topics, event.data);
});

watcher.on("contract.invoked", (event) => {
  console.log(event.contractId, event.function, event.args);
});
```

Call `engine.unsubscribeContract("my-token")` to tear it down.

### Config-based — full RPC filter shape

Use `ContractSubscriptionConfig` when you need RPC-level topic matching:

```ts
import type { ContractSubscriptionConfig } from "@orbital-stellar/pulse-core";

const config: ContractSubscriptionConfig = {
  filters: [
    {
      type: "contract",                 // "contract" | "system" | "diagnostic"
      contractIds: ["CAAAA...CONTRACT_ID"],
      topics: [["*", "**"]],           // segment arrays; each segment is '*', '**', or a base64 XDR ScVal
    },
  ],
};

const watcher = engine.subscribeContract(config);

watcher.on("contract.emitted", (event) => { /* … */ });
```

Call `engine.unsubscribeContract(config)` to tear it down.

### Filter limits

| Constraint | Limit |
|---|---|
| Filters per subscription | ≤ 5 |
| `contractIds` per filter | ≤ 5 |
| Topic segment values | `*`, `**`, or base64 XDR ScVal |

Multiple subscriptions that share identical filters are coalesced into a single Soroban RPC call, so subscribing the same contract N times uses only one filter slot.

---

## Event shapes

### `contract.emitted`

Fires for every Soroban `ContractEvent` type = `contract` (events explicitly emitted by a contract with `env.events().publish()`).

```ts
type ContractEmittedEvent = {
  type: "contract.emitted";
  contractId: string;          // Stellar contract address (C…)
  topics: string[];            // ordered topic strings
  data: unknown;               // raw event data payload
  decodedData?: unknown;       // ABI-decoded data (requires abiRegistry in CoreConfig)
  ledger?: number;             // ledger sequence number
  eventId?: string;            // unique ID from the Soroban RPC
  txHash?: string;             // containing transaction hash
  inSuccessfulContractCall?: boolean;
  timestamp: string;           // ISO 8601
  raw?: RawSorobanEvent;
};
```

### `contract.invoked`

Fires for Soroban `system` and `diagnostic` event types — contract function invocations captured at the ledger level.

```ts
type ContractInvokedEvent = {
  type: "contract.invoked";
  contractId: string;
  function: string;            // name of the invoked function
  args: unknown[];             // ordered argument list
  ledger?: number;
  txHash?: string;
  timestamp: string;           // ISO 8601
  decodedData?: unknown;
  inSuccessfulContractCall?: boolean;
  raw?: RawSorobanEvent;
};
```

### Handling both

```ts
watcher.on("contract.emitted", (event) => {
  // event.type === "contract.emitted"
  const [fnName, ...rest] = event.topics;
  console.log(`${fnName} from ${event.contractId}`, rest, event.data);
});

watcher.on("contract.invoked", (event) => {
  // event.type === "contract.invoked"
  console.log(`${event.function}(${event.args.join(", ")}) on ${event.contractId}`);
});
```

---

## Poll loop

`engine.start()` drives a self-ticking poll loop that calls `getEvents` every `pollIntervalMs` milliseconds (default 2 s). The loop:

1. Reads the current cursor from the cursor store (or starts from `latestLedger - startLedgerLookback` on first boot).
2. Issues one or more `getEvents` RPC calls, batching up to 5 filters per call.
3. Delivers each new event to all matching watcher handlers in ledger order.
4. Advances and persists the cursor so restarts pick up where they left off.

The loop is non-blocking: each poll waits for the previous one to settle, so a slow handler does not cause overlapping calls.

---

## Working example — testnet token contract

The snippet below runs against a public Stellar testnet endpoint. Replace `CONTRACT_ID` with any deployed testnet contract that emits events.

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { FileCursorStore } from "@orbital-stellar/pulse-core";
import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";

const CONTRACT_ID = "CAAAA...YOUR_TESTNET_CONTRACT";   // ← replace

const engine = new EventEngine({
  network: "testnet",
  soroban: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    startLedgerLookback: 100,  // catch up the last ~100 ledgers on first boot
  },
  cursorStore: new FileCursorStore(".orbital-cursor.json"),
});

engine.start();

const watcher = engine.subscribeContract("token-watcher", {
  filters: [{ contractIds: [CONTRACT_ID] }],
});

watcher.on("contract.emitted", (event: ContractEmittedEvent) => {
  const [fnName] = event.topics;
  console.log(`[${event.ledger}] ${fnName} — txHash: ${event.txHash}`);
  console.log("  topics:", event.topics);
  console.log("  data  :", event.data);
});

process.on("SIGINT", () => engine.stop());
```

A `FileCursorStore` persists the Soroban cursor to disk so the process resumes from the correct ledger after a restart.

---

## RPC retention limits

The Soroban RPC retains event history for a limited window:

| Retention | Duration |
|---|---|
| Default (Stellar public RPC) | 24 hours |
| Maximum (operator-configured) | 7 days |

Once a ledger falls outside the retention window, any cursor pointing into it is **expired**. `pulse-core` detects this automatically.

### Cursor-expiry recovery

When the RPC rejects a cursor with `"startCursor"` or `"oldest ledger"` in the error message, the engine:

1. Emits an `engine.cursor_expired` event with `{ source: "soroban", lostCursor }`.
2. Falls back to the RPC's current `latestLedger` as the new start point.
3. Logs a warning that data loss occurred and schedules a retry.

Listen to detect and handle expiry:

```ts
engine.on("engine.cursor_expired", ({ source, lostCursor }) => {
  if (source === "soroban") {
    console.warn(`Soroban cursor expired: ${lostCursor}. Events before recovery point are lost.`);
    // Alert, page on-call, trigger a historical backfill, etc.
  }
});
```

**To minimise the risk of expiry:**
- Keep processes running continuously, or restart within the retention window.
- Use `startLedgerLookback` on boot to catch up the most recent ledgers immediately.
- For gaps larger than the retention window, use `engine.replaySoroban` to back-fill from a known start ledger before switching to live polling.

---

## Pausing and resuming

```ts
engine.pauseSource("soroban");   // stop polling, keep the Horizon stream alive
engine.resumeSource("soroban");  // restart from the last cursor
```

---

## Related

- [ABI Registry & Typed Event Decoding](./abi-registry.md) — decode raw Soroban event data into typed JavaScript objects
- [Real-time Events guide](./real-time-events.md) — Horizon account streaming with `engine.subscribe`
