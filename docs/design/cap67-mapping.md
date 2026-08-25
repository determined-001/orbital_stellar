# CAP-67 to NormalizedEvent Mapping

## Context
Protocol 23's CAP-67 enables classic Stellar asset movements (transfer, mint, burn, clawback, set_authorized) to emit Soroban-format events in a single unified stream. This document establishes the definitive mapping from CAP-67 event shapes to the existing `NormalizedEvent` taxonomy defined in `packages/pulse-core/src/events.ts`.

---

## Mapping Table

The following table dictates how raw Soroban-formatted CAP-67 events map to our `NormalizedEvent` schema.

| CAP-67 Topics (Array) | CAP-67 Data Shape | Map-Based Memo Support | Target `NormalizedEvent` Type |
| :--- | :--- | :--- | :--- |
| `["transfer", asset, from, to]` | `[amount, memo]` (Tuple) | Data contains a Map/Struct for memo: `{ memo: string \| id \| hash \| none }` | `AssetTransfer` |
| `["mint", admin, to]` | `amount` (i128) | N/A | `AssetMint` |
| `["burn", from]` | `amount` (i128) | N/A | `AssetBurn` |
| `["clawback", admin, from]` | `amount` (i128) | N/A | `AssetClawback` |
| `["set_authorized", admin, id, authorize]` | `[]` (Empty) | N/A | `AssetAuthSet` |
| `["fee", asset, from, to]` | `amount` (i128) | N/A | `FeeIncurred` (See note below) |

---

## SAC Issuer Semantics (Mint/Burn vs. Transfer)
When the Stellar Asset Contract (SAC) is interacted with, standard transfers involving the asset's issuer are emitted differently to accurately reflect supply changes:
* **Mint:** If a `transfer` operation sends tokens *from* the issuer to a user, CAP-67 emits a `mint` event (not a `transfer` event).
* **Burn:** If a `transfer` operation sends tokens *from* a user back to the issuer, CAP-67 emits a `burn` event (not a `transfer` event).
* **Implementation Rule:** The parser should map SAC `mint`/`burn` events directly to `AssetMint` and `AssetBurn`. Do not attempt to reverse-engineer them into `AssetTransfer` events. 

---

## Fee-Event Handling
CAP-67 introduces a native `fee` event that emits when classic transactions pay network fees, unifying fee tracking.
* **Taxonomy Action:** This maps to a new `NormalizedEvent` type: `FeeIncurred`. 
* **Note:** Previously, fees were derived implicitly from the transaction metadata. The unified ingestion pipeline must now rely on this explicit `fee` event for Soroban/CAP-67 fee tracking to avoid double-counting.

---

## Horizon-Only Events (No Unified CAP-67 Equivalent)
The following events in our `NormalizedEvent` taxonomy do not have CAP-67 equivalents. These must remain exclusively Horizon-sourced via classic operation ingestion:

1. `ManageOffer` / `CreatePassiveSellOffer`
2. `ManageData`
3. `SetOptions` (Account options, signers, thresholds, home domain)
4. `ClaimableBalance` (Create/Claim)
5. `AccountMerge`
6. `PathPayment` (Strict Send / Strict Receive - note: the *underlying* asset movements will emit CAP-67 transfers, but the path execution intent remains Horizon-only)
7. `Sponsorship` (Begin/End/Revoke)
8. `Inflation`
