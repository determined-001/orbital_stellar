# Semantic layer

The semantic layer sits **above** raw Soroban topics and ABI-decoded
payloads. It turns opaque on-chain material — a topic hash, a C-address, an
`i128` amount — into names people can reason about: `token.transferred`,
`swap.executed`, `Circle (USDC Issuer)`.

Without it, API docs alone make “semantic taxonomy” sound like jargon. With
it, the difference between a topic symbol like `transfer` and a mapped name
like `token.transferred` is concrete.

This document covers what ships in the repo today (entity labels, ABI
registry precedence, decode) and the taxonomy **mapping** model Wave 2.3
adds on top (`TaxonomyResolver` / `taxonomy.schema.json`).

---

## Honesty rule

**Unmapped events stay unmapped. The layer never guesses a name.**

| Surface | On miss |
|---|---|
| Taxonomy mapping | No `semantic` field — the event is still delivered with its decoded topic |
| Entity label | `LabelResolver.resolve()` returns `null` |
| ABI decode | `decodedData` stays `undefined`; a structured `{ error }` may be logged, but the raw event is not rewritten |

There is no fuzzy match, no “probably a swap”, and no inventing a protocol
name from bytecode shape alone. If a mapping or label record is not present,
consumers see the absence explicitly.

---

## What a mapping is

A **mapping** is an explicit taxonomy record that binds an on-chain event
topic to a canonical semantic name.

Record shape (see `packages/abi-registry/schema/taxonomy.schema.json` once
Wave 2.3 / issue 11.1 lands):

```json
{
  "version": "0.1.0",
  "mappings": [
    {
      "scope": { "interfaceId": "sep41-sac" },
      "eventTopic": "transfer",
      "semantic": "token.transferred"
    },
    {
      "scope": { "interfaceId": "soroban-amm-v1" },
      "eventTopic": "swap",
      "semantic": "swap.executed"
    }
  ]
}
```

- **`eventTopic`** — the decoded first topic symbol (e.g. `"transfer"`,
  `"swap"`), the same string `decodeContractEvent` exposes as
  `functionName`. Not the raw base64 XDR blob.
- **`semantic`** — dot-separated lowercase segments (`token.transferred`,
  `swap.executed`). This is the human-readable taxonomy name.
- **`scope`** — exactly one of:
  - `contractId` — this specific mainnet/testnet contract
  - `specHash` — every deployment sharing the same canonical spec / WASM hash
  - `interfaceId` — structural family match (e.g. SEP-41 SAC token interface)

Mappings are open data under community review (Wave 2.3). They are never
inferred from an unknown topic at resolve time.

---

## What a label is

A **label** is advisory attribution for a contract address — protocol name,
issuer, deployer, or bridge — loaded from `data/labels/*.json`.

```ts
import { LabelResolver } from "@orbital-stellar/abi-registry";

const labels = new LabelResolver({ enabled: true });
labels.resolve("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
// → { label: "Circle (USDC Issuer)", entityType: "issuer", confidence: 1 }
```

Rules:

- Opt-in only (`enabled: true`). Default is off so labels never become
  load-bearing for correctness by accident.
- Unknown contract IDs resolve to `null` — never a guessed string.
- Schema: `packages/abi-registry/schemas/label.schema.json`.
- Seed data: `data/labels/` (USDC, EURC, AQUA, native XLM wrapper, Soroswap
  Router, Phoenix Pool Factory).

Labels answer *who* an address is. Mappings answer *what happened*.

---

## How precedence resolves

Two independent chains matter. Neither invents a result on a miss.

### 1. Taxonomy mapping precedence

When resolving `(contractId, eventTopic, specHash?, interfaceId?)`:

1. Exact **`contractId`** mapping  
2. **`specHash`** family mapping (same code / canonical spec)  
3. **`interfaceId`** structural match (e.g. SEP-41 SAC)  
4. **Unmapped** — no semantic name attached

Same-tier conflicts (two mappings for the same scope + topic with different
semantics) are a **load-time** error, not a silent pick at resolve time.

### 2. ABI registry precedence (decode)

`createDefaultAbiRegistryClient()` builds the default decode chain when
`CoreConfig.abiRegistry` is omitted:

1. **SEP-48 embedded** — `#[contractevent]` from WASM (only when `rpcUrl` is passed)  
2. **Bundled well-known** — offline USDC / EURC / AQUA / native XLM specs  
3. **On-chain registry** — once `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` is set  

First match wins. A registry miss leaves `decodedData` undefined; it does
not invent a function name.

Pass `abiRegistry: false` to opt out of the default chain entirely.

---

## What is deliberately not inferred

- A topic symbol is **not** remapped to a classic `NormalizedEvent` type
  (`transfer` does not become `payment.received`).
- An unknown contract does **not** get a protocol label.
- An unknown topic does **not** get a semantic name such as `swap.executed`.
- Decode failure does **not** rewrite `event.data`; the raw payload stays.
- Labels are **not** used for authorization, routing, or fee decisions.

---

## Worked example: one mainnet event, three ways

Captured live from Stellar mainnet RPC (`getEvents`) on 2026-07-29 against
Circle’s USDC SAC
(`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`).

| Field | Value |
|---|---|
| Ledger | `63705600` |
| Closed at | `2026-07-29T16:56:34Z` |
| Tx hash | `f1b942a37cd85b06573062d7424c5f135ad42e2902fb8f8bdc3df774d6dd32a1` |
| Event id | `0273613468572065792-0000000000` |

This is a real stream capture, not a hand-written payload.

### 1. Raw XDR (as returned by RPC)

```json
{
  "type": "contract",
  "ledger": 63705600,
  "ledgerClosedAt": "2026-07-29T16:56:34Z",
  "contractId": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  "txHash": "f1b942a37cd85b06573062d7424c5f135ad42e2902fb8f8bdc3df774d6dd32a1",
  "topic": [
    "AAAADwAAAAh0cmFuc2Zlcg==",
    "AAAAEgAAAAAAAAAAB3D9M5SEF1+4r1Uy/QmrqYcZamKrf7UMXvEHESKOwto=",
    "AAAAEgAAAAAAAAAAKA/dfVd4IWhjM//yp1gJ4pXPfhPyO9ns8x/2Aa4xv/c=",
    "AAAADgAAAD1VU0RDOkdBNVpTRUpZQjM3SlJDNUFWQ0lBNU1PUDRSSFRNMzM1WDJLR1gzSUhPSkFQUDVSRTM0SzRLWlZOAAAA"
  ],
  "value": "AAAACgAAAAAAAAAAAAAAAAe/pIA="
}
```

At this layer you only have base64 `ScVal` blobs. The first topic happens to
decode to the symbol `transfer`, but nothing yet says “token transferred” or
“Circle”.

### 2. Decoded (ABI registry + `decodeContractEvent`)

With the bundled USDC well-known spec (or any registry hit for this
contract), the same event becomes:

```json
{
  "functionName": "transfer",
  "topics": [
    "transfer",
    "GADXB7JTSSCBOX5YV5KTF7IJVOUYOGLKMKVX7NIML3YQOEJCR3BNUZHL",
    "GAUA7XL5K54CC2DDGP77FJ2YBHRJLT36CPZDXWPM6MP7MANOGG77PNJU",
    "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  ],
  "data": "130000000"
}
```

`130000000` is 13.0 USDC at 7 decimal places. This is still the **contract’s
own topic name** (`transfer`), not a semantic taxonomy name.

### 3. Semantic and labeled

Apply taxonomy mapping (SEP-41 SAC `transfer` → `token.transferred`) and
entity labels (`LabelResolver` with `enabled: true`):

```json
{
  "type": "contract.emitted",
  "contractId": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  "semantic": "token.transferred",
  "decodedData": {
    "functionName": "transfer",
    "topics": [
      "transfer",
      "GADXB7JTSSCBOX5YV5KTF7IJVOUYOGLKMKVX7NIML3YQOEJCR3BNUZHL",
      "GAUA7XL5K54CC2DDGP77FJ2YBHRJLT36CPZDXWPM6MP7MANOGG77PNJU",
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    ],
    "data": "130000000"
  },
  "label": {
    "label": "Circle (USDC Issuer)",
    "entityType": "issuer",
    "confidence": 1
  }
}
```

Contrast with a topic hash / symbol you have never mapped: if the first
topic were an unknown symbol (or a contract with no taxonomy entry),
`semantic` would be absent and the label would be `null`. That is the
difference between a raw topic and `swap.executed` — an **explicit mapping
record**, not a decoder guess.

Reproduce the capture:

```bash
curl -s -X POST https://mainnet.sorobanrpc.com \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "getEvents",
    "params": {
      "startLedger": 63705600,
      "filters": [{
        "type": "contract",
        "contractIds": ["CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"]
      }],
      "pagination": { "limit": 1 }
    }
  }'
```

---

## Where this lives in the codebase

| Piece | Location |
|---|---|
| Entity labels | `packages/abi-registry/src/LabelResolver.ts`, `data/labels/` |
| Label schema | `packages/abi-registry/schemas/label.schema.json` |
| Decode | `packages/abi-registry/src/decode.ts` |
| Default registry chain | `packages/abi-registry/src/createDefaultAbiRegistryClient.ts` |
| Taxonomy resolver (Wave 2.3) | `packages/abi-registry/src/taxonomy/` |
| Architecture overview | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) §2.1 |
| ABI usage guide | [`apps/web/content/guides/abi-registry.md`](../apps/web/content/guides/abi-registry.md) |

---

## Related reading

- [`ROADMAP.md`](../ROADMAP.md) — Wave 2.3 Semantic layer
- [`docs/open-source-policy.md`](./open-source-policy.md) — taxonomy/labels as open data
- [`STABILITY.md`](../STABILITY.md) — when wire shapes may change
