# Worker Manifest Standard

**Schema `$id`:** `https://orbital-stellar.io/schema/worker.manifest.json`  
**Current version:** `1.0.0`  
**Source:** `packages/worker-core/schema/worker.manifest.json`  
**Issue:** #1058 — 20.4 Worker manifest standard and validator

---

## What a manifest is

A `worker.manifest.json` is a self-contained descriptor of a worker: what it
does, when it fires, what contract it invokes, how late it can be before it
is penalised, and what on-chain event proves it ran.

Any scheduler can emit this format and any consumer can validate it — including
implementations that never use `@orbital-stellar/worker-core`. The format is
the durable asset; the package is optional tooling.

The verification engine (19.1) uses a manifest alone to score a worker against
on-chain evidence: it fetches the `fireEvent` from Stellar RPC and compares the
ledger timestamp to the `latencyBound`. No operator cooperation is required.

---

## Compatibility policy

`manifestVersion` is currently `"1.0.0"`.

| Bump type | What changes | Old manifests |
|---|---|---|
| **Patch** (1.0.x) | Editorial only (typos, description improvements) | Still valid |
| **Minor** (1.x.0) | New *optional* fields added | Still valid — unknown fields are ignored |
| **Major** (x.0.0) | Breaking structural change; `$id` changes | Must be migrated |

Consumers **must** check `manifestVersion` before processing.

---

## Top-level fields

| Field | Required | Type | Description |
|---|---|---|---|
| `manifestVersion` | ✅ | `"1.0.0"` | Schema version. Must be `"1.0.0"` for v1 manifests. |
| `id` | ✅ | string | Stable globally-unique worker identifier, e.g. `"my-org/oracle"`. Appears in fire events and reputation records — changing it is a breaking change. Pattern: `^[a-zA-Z0-9_\-./]+$` |
| `name` | ✅ | string | Human-readable display name (max 120 chars). |
| `trigger` | ✅ | object | What causes the worker to fire. See [Trigger](#trigger). |
| `target` | ✅ | object | The contract and function to invoke. See [Target](#target). |
| `latencyBound` | ✅ | object | Contractual latency commitment. See [LatencyBound](#latencybound). |
| `fireEvent` | ✅ | object | On-chain event that confirms execution. See [FireEvent](#fireevent). |
| `description` | | string | Free-text description (max 1000 chars). |
| `version` | | string | SemVer of this worker implementation, e.g. `"1.0.0"`. |
| `network` | | `"mainnet"` \| `"testnet"` \| `"futurenet"` | The Stellar network this worker runs on. |
| `author` | | string | Operator identity, e.g. GitHub handle. |
| `repository` | | URI | Source repository URL. |
| `tags` | | string[] | Discovery tags (max 20, each max 64 chars). |

---

## Trigger

Currently only `"cron"` (time-based) triggers are defined. Additional trigger
classes will be added in later milestones with a minor version bump.

### CronTrigger

```json
{
  "class": "cron",
  "cron": "0 * * * *",
  "timezone": "UTC",
  "windowSec": 60
}
```

| Field | Required | Description |
|---|---|---|
| `class` | ✅ | Must be `"cron"`. |
| `cron` | ✅ | Standard five-field cron expression. |
| `timezone` | ✅ | IANA timezone name (e.g. `"UTC"`, `"America/New_York"`). |
| `windowSec` | | Fire window width in seconds (1–86400). Default: 60. The scheduler must fire within this window starting at the cron moment. |

---

## Target

The Soroban contract and function the worker calls when it fires.

```json
{
  "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  "function": "update_price",
  "params": [
    { "name": "price", "type": "u128", "doc": "Scaled price." }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `contractId` | ✅ | Bech32 Soroban address (`C` + 55 base32 chars). |
| `function` | ✅ | Exported function name. Must match `^[a-zA-Z_][a-zA-Z0-9_]*$`. |
| `params` | | Ordered static parameter descriptors. Dynamic parameters resolved at fire time are not listed here. |

---

## LatencyBound

**This field makes tier pricing expressible.** Without it "late" has no
contractual meaning and the verification engine cannot score the worker.

```json
{
  "maxSeconds": 25,
  "targetSeconds": 8,
  "tier": "fast"
}
```

| Field | Required | Description |
|---|---|---|
| `maxSeconds` | ✅ | Maximum seconds from trigger moment to confirmed on-chain fire event (1–86400). A worker whose fire event lands after `triggerTime + maxSeconds` is scored **late**. |
| `targetSeconds` | | Optional P50 target for dashboard reporting. Must be `< maxSeconds`. |
| `tier` | | Advisory label (`"standard"`, `"fast"`, `"realtime"`, etc.). Scoring uses `maxSeconds`, not this label. |

---

## FireEvent

The on-chain Soroban event that confirms the worker's invocation succeeded.
The verification engine fetches this event from Stellar RPC using `contractId`
and `topics` — with **no operator cooperation required**.

```json
{
  "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  "topics": [
    { "kind": "symbol", "value": "price_updated" },
    { "kind": "typed", "type": "address", "doc": "Caller." }
  ],
  "dataFields": [
    { "name": "price", "type": "u128", "doc": "Written value." }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `contractId` | ✅ | Contract that emits the confirmation event. Usually the same as `target.contractId` but may differ for proxy patterns. |
| `topics` | ✅ | Ordered topic matchers (minimum 1). |
| `dataFields` | | Data field descriptors the engine may extract for scoring metadata. |

### Topic matchers

**Symbol matcher** — the topic must be a specific Symbol value:

```json
{ "kind": "symbol", "value": "price_updated" }
```

**Typed matcher** — the topic can be any value of the given Soroban type:

```json
{ "kind": "typed", "type": "address", "doc": "Caller address." }
```

---

## Standalone validator

The validator in `packages/worker-core/src/manifest.ts` has **no runtime
dependency** on `@orbital-stellar/worker-core` beyond that file. Copy it into
any project or use the package:

```ts
import { validateManifest, parseManifest } from "@orbital-stellar/worker-core";

// Validate an object
const result = validateManifest(someObject);
if (!result.valid) {
  console.error(result.errors);
}

// Parse and validate a JSON string (throws ManifestValidationError on failure)
const manifest = parseManifest(jsonString);
```

### Standalone CLI validation

The `validate.js` idiom from `abi-registry` can be replicated for manifests:

```js
// validate-manifest.js
import { readFileSync } from "fs";
import { validateManifest } from "@orbital-stellar/worker-core";

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const result = validateManifest(raw);

if (result.valid) {
  console.log("PASS");
  process.exit(0);
} else {
  for (const err of result.errors) {
    console.error(`  ${err.path}: ${err.message}`);
  }
  process.exit(1);
}
```

---

## Fluent builder (worker-core)

```ts
import { WorkerManifestBuilder } from "@orbital-stellar/worker-core";

const manifest = new WorkerManifestBuilder()
  .id("my-org/xlm-oracle")
  .name("XLM Price Oracle")
  .description("Pushes XLM/USDC price into oracle contract every minute.")
  .version("1.0.0")
  .network("mainnet")
  .trigger({ class: "cron", cron: "* * * * *", timezone: "UTC", windowSec: 30 })
  .target({
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    function: "update_price",
    params: [{ name: "price", type: "u128" }],
  })
  .latencyBound({ maxSeconds: 25, targetSeconds: 8, tier: "fast" })
  .fireEvent({
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    topics: [{ kind: "symbol", value: "price_updated" }],
    dataFields: [{ name: "price", type: "u128" }],
  })
  .build(); // throws ManifestValidationError if any required field is missing

// Write to disk
import { writeFileSync } from "fs";
writeFileSync("worker.manifest.json", JSON.stringify(manifest, null, 2));
```

---

## Worked examples

Two complete examples live in `packages/worker-core/schema/examples/` and are
validated by the test suite on every CI run.

### Example 1 — XLM Price Oracle (every-minute cron, fast tier)

`schema/examples/xlm-price-oracle.manifest.json`

- Fires every minute (`"* * * * *"`), 30-second window
- Calls `update_price(price: u128, source: symbol)` on an oracle contract
- Latency bound: max 25 s, target 8 s, tier `"fast"`
- Fire event: `price_updated` symbol topic + `price`/`ledger` data fields

### Example 2 — Liquidity Pool Daily Rebalancer (midnight cron, standard tier)

`schema/examples/liquidity-pool-rebalancer.manifest.json`

- Fires at midnight UTC daily (`"0 0 * * *"`), 120-second window
- Calls `rebalance(caller: address)` on a pool contract
- Latency bound: max 90 s, target 30 s, tier `"standard"`
- Fire event: `rebalance_executed` with typed `address` second topic and
  `token_a_moved`/`token_b_moved`/`new_ratio` data fields

---

## Designing for interoperability

The point of this standard is that a **competitor can implement it without
Orbital's code**. When designing workers intended for external adoption:

1. **Use the stable `$id`** — consumers that cache schemas by `$id` will
   automatically pick up minor-version additions without code changes.
2. **Keep `id` stable** — it appears in fire events and reputation records.
   Treat it like a package name: rename with a major version bump only.
3. **Be precise about `fireEvent.topics`** — the verification engine matches
   them in order. The more specific your matchers, the lower the false-positive
   rate in scoring.
4. **Set `latencyBound.maxSeconds` conservatively** — the bound is a
   contractual commitment, not an aspiration. If you miss it you are scored
   late regardless of network conditions.
5. **Emit `manifestVersion`** — consumers must check this field. Omitting it
   causes all validators to reject the manifest immediately.
