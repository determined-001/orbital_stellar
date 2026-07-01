---
title: ABI Registry & Typed Event Decoding
description: Wire AbiRegistryClient into EventEngine to decode raw Soroban contract events into fully-typed JavaScript objects.
---

By default, every `contract.emitted` event that reaches your watcher carries the raw on-chain data in its `data` field — an opaque XDR blob or an untyped JSON object depending on how the Soroban RPC decoded it. Without a contract ABI, `decodedData` is always `undefined`.

The **ABI Registry** solves this: once you attach a registry client to `EventEngine`, every `contract.emitted` event for a known contract is enriched with a fully-typed `decodedData` value before it hits your handler.

## Before and after

### Before — raw event (no registry)

```ts
watcher.on("contract.emitted", (event) => {
  console.log(event.data);
  // { sym: "transfer" } — or a raw XDR base64 string, depending on the RPC
  console.log(event.decodedData);
  // undefined  ← nothing to work with
});
```

### After — decoded event (registry attached)

```ts
watcher.on("contract.emitted", (event) => {
  console.log(event.data);
  // { sym: "transfer" } — raw value still present
  console.log(event.decodedData);
  // {
  //   functionName: "transfer",
  //   topics: ["transfer", "GABC…sender", "GXYZ…recipient"],
  //   data: "150000000"   // i128 as a string — 15 USDC (7 decimals)
  // }
});
```

---

## Clients

The `@orbital-stellar/abi-registry` package ships two clients. Both implement the same `AbiRegistryClientLike` interface accepted by `CoreConfig.abiRegistry`, so they are interchangeable.

### `AbiRegistryClient` — hosted registry (recommended for production)

Fetches specs over HTTP from your hosted ABI registry and keeps them in an LRU cache (default: 512 entries, 5-minute TTL).

```ts
import { AbiRegistryClient } from "@orbital-stellar/abi-registry";

const abiRegistry = new AbiRegistryClient({
  baseUrl: "https://abi.stellar.org",  // your hosted registry endpoint
});
```

**Config options:**

| Option          | Type     | Default       | Description                                     |
|-----------------|----------|---------------|-------------------------------------------------|
| `baseUrl`       | `string` | **required**  | Base URL of the hosted registry                 |
| `maxCacheSize`  | `number` | `512`         | Maximum specs kept in the LRU cache             |
| `cacheTtlMs`    | `number` | `300_000`     | Per-spec TTL in milliseconds (5 min)            |
| `transport`     | function | `globalThis.fetch` | Override the HTTP transport (e.g. for testing) |

All outbound requests include:

```
Accept: application/vnd.orbital.abi-registry+json; version=1
```

A `406 Not Acceptable` response means the server doesn't support spec version 1 — the client throws rather than silently parse an incompatible payload.

---

### `LocalAbiRegistryClient` — file-system registry (offline / self-hosted)

Reads spec JSON files from a local directory. Zero network calls; ideal for CI, development, or air-gapped deployments.

```ts
import { LocalAbiRegistryClient } from "@orbital-stellar/abi-registry";
import path from "node:path";

const abiRegistry = new LocalAbiRegistryClient({
  specsDir: path.resolve("packages/abi-registry/specs/well-known"),
});
```

Each file must be named `<contractId>.json` and follow the registry spec format. The well-known specs bundled in the repository are a ready-to-use starting point (see [Well-known specs](#well-known-specs)).

**Config options:**

| Option         | Type     | Default   | Description                                          |
|----------------|----------|-----------|------------------------------------------------------|
| `specsDir`     | `string` | **required** | Absolute path to the directory of `<contractId>.json` files |
| `maxCacheSize` | `number` | `512`     | Maximum specs kept in the LRU cache                  |
| `cacheTtlMs`   | `number` | `300_000` | Per-spec TTL in milliseconds (5 min)                 |

---

## Wiring into `EventEngine`

Pass either client via the `abiRegistry` field in `CoreConfig`:

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { AbiRegistryClient } from "@orbital-stellar/abi-registry";

const abiRegistry = new AbiRegistryClient({
  baseUrl: "https://abi.stellar.org",
});

const engine = new EventEngine({
  network: "mainnet",
  soroban: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
  },
  abiRegistry, // ← attach here
});

engine.start();
```

That is the only change required. The engine looks up each `contract.emitted` event's `contractId` in the registry and, if a spec is found, populates `event.decodedData` before delivering the event to your watchers.

> **`decodedData` is `undefined` when:**
> - No `abiRegistry` is configured.
> - The registry returns `null` for the contract (spec not found).
> - Decoding fails — a structured `{ error: string }` object is logged, but the raw event is still delivered unmodified.

---

## End-to-end example: USDC `transfer` event

The USDC contract (`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`) emits a `transfer` event whenever tokens move between accounts.

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { LocalAbiRegistryClient } from "@orbital-stellar/abi-registry";
import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import type { DecodedEvent } from "@orbital-stellar/abi-registry";
import path from "node:path";

const USDC_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const abiRegistry = new LocalAbiRegistryClient({
  // Use the bundled well-known specs — USDC is included.
  specsDir: path.resolve("node_modules/@orbital-stellar/abi-registry/specs/well-known"),
});

const engine = new EventEngine({
  network: "mainnet",
  soroban: { rpcUrl: "https://mainnet.sorobanrpc.com" },
  abiRegistry,
});

engine.start();

const watcher = engine.subscribeContract("usdc-transfers", {
  filters: [{ contractIds: [USDC_CONTRACT_ID] }],
});

watcher.on("contract.emitted", (event: ContractEmittedEvent) => {
  if (!event.decodedData) {
    // Registry miss or decode error — fall back to raw data
    console.warn("undecodable event", event.data);
    return;
  }

  const decoded = event.decodedData as DecodedEvent;

  if (decoded.functionName !== "transfer") return;

  // topics: ["transfer", <from address>, <to address>]
  const [, from, to] = decoded.topics as string[];
  // data: i128 amount as a decimal string (7 decimal places)
  const rawAmount = decoded.data as string;
  const usdc = (BigInt(rawAmount) / 10_000_000n).toString();

  console.log(`USDC transfer: ${usdc} USDC  ${from} → ${to}`);
  // USDC transfer: 15 USDC  GABC…sender → GXYZ…recipient
});
```

### What `DecodedEvent` looks like for a USDC transfer

```json
{
  "functionName": "transfer",
  "topics": [
    "transfer",
    "GABCDEFG123…",
    "GXYZ789…"
  ],
  "data": "150000000"
}
```

The `data` value is an `i128` represented as a decimal string to preserve full 64-bit (and 128-bit) precision — never a JavaScript `number`. Divide by `10_000_000` (10^7) to get the human-readable USDC amount.

---

## Decoded type reference

`decodeContractEvent` (called internally by the engine) never throws. It always returns one of:

```ts
// Success
type DecodedEvent = {
  functionName: string;   // first-topic symbol, e.g. "transfer"
  topics: DecodedValue[]; // all decoded topic values
  data: DecodedValue;     // decoded data payload
};

// Failure — event.decodedData will contain this object
type DecodeError = {
  error: string;
};
```

### Soroban → JavaScript type mapping

| Soroban type  | JavaScript representation                             |
|---------------|-------------------------------------------------------|
| `bool`        | `boolean`                                             |
| `u32` / `i32` | `number`                                              |
| `u64` / `i64` | `string` (preserves full 64-bit precision)            |
| `u128` / `i128` | `string`                                            |
| `u256` / `i256` | `string`                                            |
| `bytes`       | `string` (hex-encoded)                                |
| `String`      | `string`                                              |
| `Symbol`      | `string`                                              |
| `Address`     | `string` (strkey — `G…` or `C…`)                     |
| `void`        | `null`                                                |
| `vec<T>`      | `DecodedValue[]`                                      |
| `map<K,V>`    | `Array<{ key: DecodedValue; value: DecodedValue }>`   |
| custom struct | `Record<string, DecodedValue>`                        |

---

## Well-known specs

The repository bundles ABI specs for the most common Stellar contracts in
`packages/abi-registry/specs/well-known/`:

| File                     | Contract                            | Contract ID                                              |
|--------------------------|-------------------------------------|----------------------------------------------------------|
| `sac-interface.json`     | Stellar Asset Contract (SAC) interface | `CAAAA…D2KM`                                          |
| `native-asset-wrapper.json` | Native XLM SAC                   | `CAS3J…H34XOWMA`                                        |
| `usdc.json`              | USD Coin (USDC)                     | `CCW67…SJMI75`                                           |
| `eurc.json`              | Euro Coin (EURC)                    | `CDTKP…JBQLV`                                            |
| `aqua.json`              | Aquarius (AQUA)                     | `CAUIK…ZXAEFBX`                                          |

Use `LocalAbiRegistryClient` pointed at this directory to get typed decoding for any of these contracts with zero network calls. Pass the directory path via `specsDir` — the client resolves `<contractId>.json` automatically.

To add your own contract, drop a JSON file named `<contractId>.json` alongside the existing specs and follow the schema in
`packages/abi-registry/specs/well-known/schema.json`.

---

## Using a custom transport (e.g. for testing)

`AbiRegistryClient` accepts an optional `transport` override — any function with the same signature as `fetch`. Use it to inject fixtures in tests without hitting a real registry:

```ts
import { AbiRegistryClient } from "@orbital-stellar/abi-registry";
import usdcSpec from "./fixtures/usdc.json" assert { type: "json" };

const mockTransport: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("CCW67")) {
    return new Response(JSON.stringify(usdcSpec), { status: 200 });
  }
  return new Response(null, { status: 404 });
};

const abiRegistry = new AbiRegistryClient({
  baseUrl: "https://abi.example.local",
  transport: mockTransport,
});
```

---

## Related

- [`packages/abi-registry/specs/well-known/`](../../../../packages/abi-registry/specs/well-known/) — bundled specs index and individual contract JSON files
- [`packages/abi-registry/specs/well-known/schema.json`](../../../../packages/abi-registry/specs/well-known/schema.json) — spec JSON schema
- [Real-time events guide](./real-time-events.md) — how `EventEngine` and `subscribeContract` work
