---
title: "CAP-67 Event Mapping to NormalizedEvent"
description: |
  Mapping specification for Stellar Asset Contract (CAP-67) events to
  pulse-core's NormalizedEvent taxonomy.

  This document describes how CAP-67 events emitted by the Stellar Asset
  Contract (native Soroban implementation) map to normalized event types in
  packages/pulse-core/src/index.ts. It covers mint and burn semantics,
  clawback handling, authorization events, and the rationale for fee-event
  inclusion/exclusion.
---

## Overview

**CAP-67** introduces a standardized Stellar Asset Contract (SAC) as a Soroban
smart contract that wraps native Stellar assets (and bridged assets) on-ledger.
The contract emits events for key lifecycle operations: mints, burns, transfers,
clawbacks, and authorization changes.

pulse-core's `EventEngine` normalizes events from both Horizon (classic
operations) and Soroban RPC (contract events) into a unified `NormalizedEvent`
discriminated union. CAP-67 events are delivered via Soroban as contract events
and must be decoded and mapped into the existing taxonomy.

---

## Architecture & Terminology

### Event Sources
- **Horizon**: Classic network events (payments, trustline changes, account options, etc.)
  - Represented in the codebase as `RawHorizonPayment`, `RawHorizonChangeTrust`, etc.
  - Normalized into types like `PaymentEvent`, `TrustlineEvent`, `AccountOptionsEvent`
- **Soroban RPC**: Contract events from contracts deployed on-ledger
  - Delivered as raw `ContractEmittedEvent` with `topics` (XDR-encoded) and `data`
  - Decoded via ABI registry into `decodedData` when a spec is available

### Event Normalization Pipeline
1. Raw event arrives from Horizon or Soroban RPC
2. `EventEngine` routes to the appropriate normalizer
3. Normalizer validates structure and extracts fields
4. If ABI registry is configured, decoder attempts to resolve and decode metadata
5. Final `NormalizedEvent` is emitted to watchers

---

## CAP-67 Operations & Mapping

The Stellar Asset Contract emits events for the following operations. Most map
to the existing `ContractEmittedEvent` type. Simple transfers of native/bridged
assets may also be observable as classic `PaymentEvent` if they route through
Horizon.

| CAP-67 Operation | Stellar Asset Contract Event | Primary Mapping | Secondary/Legacy | Rationale |
|---|---|---|---|---|
| **Mint** | `transfer` (to account, from contract) | `ContractEmittedEvent` (contract.emitted, decodedData: mint metadata) | `PaymentEvent` (if mirrored to Horizon) | CAP-67 SAC mints by transferring from the contract's reserve. Soroban is the authoritative source; Horizon may lag or not mirror. |
| **Burn** | `burn` (balance decrease) | `ContractEmittedEvent` (contract.emitted, decodedData: burn metadata) | N/A | Burn is a contract-only operation with no Horizon equivalent. The event confirms balance removal. |
| **Transfer** | `transfer` (between accounts) | `ContractEmittedEvent` (contract.emitted, decodedData: transfer metadata) | `PaymentEvent` (if classic operation routes to Horizon) | Transfers between holder accounts. May be observable as Horizon payment if SAC wraps classic asset and dual-delivery is configured. |
| **Clawback** | `clawback` (admin operation) | `ContractEmittedEvent` (contract.emitted, decodedData: clawback metadata) | N/A | Clawback is contract-privileged; no Horizon equivalent. |
| **Authorization** | `authorize` / `deauthorize` | `ContractEmittedEvent` (contract.emitted, decodedData: authorization metadata) | `TrustAuthEvent` (if wrapped asset and classic trustline event) | Authorization state changes are Soroban-native. Classic assets may also emit Horizon `set_trust_line_flags`. |
| **Fee Events** | (balance adjustments, implicit in transfer) | N/A (not emitted as discrete events) | N/A | Fees are not standalone events; they reduce transfer amounts. See rationale below. |

---

## Detailed Semantics

### Mint

**Definition**: An increase in total supply of an asset, typically by the asset admin.

- **Soroban Event**: `transfer` event with `from == contract_address` and `to == recipient`
- **Normalized Type**: `ContractEmittedEvent` (type: "contract.emitted")
- **Decoded Metadata** (via ABI): 
  - `topics[0]` = `"transfer"` (or similar contract-specific event topic)
  - `decodedData` includes: `from`, `to`, `amount`, potentially `id` (asset identifier)
- **Horizon Visibility**: Unlikely unless a bridged contract explicitly mirrors to Horizon
- **Use Case**: Tracking new issuance, monitoring supply inflation

---

### Burn

**Definition**: A decrease in total supply, typically by the asset admin removing tokens from circulation.

- **Soroban Event**: Contract emits `burn` event (or `transfer` with `to == contract_address`)
- **Normalized Type**: `ContractEmittedEvent` (type: "contract.emitted")
- **Decoded Metadata** (via ABI):
  - `topics[0]` = `"burn"` (or similar)
  - `decodedData` includes: `from`, `amount`, potentially `id` (asset)
- **Horizon Visibility**: No Horizon equivalent
- **Use Case**: Tracking deflation, removing tokens from circulation

---

### Transfer

**Definition**: Movement of tokens between two account holders.

- **Soroban Event**: Contract emits `transfer` event with `from` and `to` (both != contract)
- **Normalized Type**: `ContractEmittedEvent` (type: "contract.emitted"), or `PaymentEvent` (if bridged to Horizon)
- **Decoded Metadata** (via ABI):
  - `topics[0]` = `"transfer"`
  - `decodedData` includes: `from`, `to`, `amount`, `id`
- **Horizon Visibility**: May appear as `PaymentEvent` (type: "payment.received" or "payment.sent") if SAC is bridged and dual-delivery is active
- **Use Case**: Tracking user transactions, commerce flows, settlement

---

### Clawback

**Definition**: Admin-privileged removal of tokens from an account (if authorized by asset issuer).

- **Soroban Event**: Contract emits `clawback` event
- **Normalized Type**: `ContractEmittedEvent` (type: "contract.emitted")
- **Decoded Metadata** (via ABI):
  - `topics[0]` = `"clawback"`
  - `decodedData` includes: `from`, `amount`, potentially `admin`, `id`
- **Horizon Visibility**: No Horizon equivalent; Soroban only
- **Use Case**: Regulatory compliance (recovery), fraud prevention, account freezing

---

### Authorization (Approve / Revoke)

**Definition**: Grant or revoke spending authority (allowance) to a third party.

- **Soroban Event**: Contract emits `authorize` or `deauthorize` event
- **Normalized Type**: `ContractEmittedEvent` (type: "contract.emitted"), or `TrustAuthEvent` (if wrapped asset with classic trustline)
- **Decoded Metadata** (via ABI):
  - `topics[0]` = `"authorize"` or `"deauthorize"`
  - `decodedData` includes: `from`, `spender`, `amount`, `id`
- **Horizon Visibility**: If a classic asset is wrapped, `TrustAuthEvent` (type: "trustline.authorized" / "trustline.deauthorized") may appear alongside
- **Use Case**: Tracking approvals, monitoring delegated spending, security audits

---

## Fee Events

### Rationale for Exclusion as Discrete Events

Fees in CAP-67 are **not emitted as standalone events**. Instead, they are
deducted from the transferred amount and implicitly reflected in the balance
state.

**Reasoning**:

1. **Implicit in Transfer Amount**: When a user calls `transfer(to, amount)`, the fee (if any) is already deducted from the sender's balance. The contract does not emit a separate `fee` event.

2. **Avoid Event Proliferation**: Emitting per-transfer fee events would double event count and add complexity to client-side aggregation.

3. **Balance State is Authoritative**: The account's final balance after a transfer includes all deductions (fees, amounts paid). Clients can derive fees by tracking balance changes across events.

4. **Historical Limitation**: Classic Horizon does not expose fees as discrete events; they are visible only via transaction envelopes. Maintaining consistency with the established paradigm avoids surprise API changes.

### Client Fee Tracking

Clients interested in fee data should:

- Subscribe to `transfer` events and compare sender/recipient balance changes
- Query the contract's fee configuration (if exposed by the SAC implementation)
- Correlate transaction records with contract event payloads (via `txHash`)

**Example**:
```
Event 1: transfer(alice, bob, 100) → bob gains 100
         (If alice's balance dropped by 101, fee was 1)
```

---

## Implementation Notes for Decoder / Normalizer

### ABI Registry Integration

The `EventEngine` uses an `AbiRegistryClientLike` to look up and decode contract
specs. When decoding CAP-67 events:

1. **Contract Identification**: Extract `contractId` from the Soroban event
2. **Spec Lookup**: Query the registry for the spec at the ledger number
3. **Topic Parsing**: Decode the first topic (event type discriminant)
4. **Data Extraction**: Decode the remaining topics and data payload
5. **Normalization**: Map decoded fields into the appropriate `decodedData` structure

### Error Handling

If ABI registry lookup or decoding fails:

- Emit a `DecodeFailedNotification` with the contract ID and error message
- Still emit the `ContractEmittedEvent` with `decodedData = undefined`
- Log and continue (don't crash the event stream)

### Type Narrowing in pulse-core

Consumers can narrow contract events using TypeScript guards:

```typescript
import type { events } from "@orbital-stellar/pulse-core";

function handleContractEvent(e: events.ContractEmittedEvent) {
  if (e.topics[0] === "transfer") {
    // Handle transfer
    const tx = e.decodedData as TransferMetadata;
    console.log(`Transferred ${tx.amount} from ${tx.from} to ${tx.to}`);
  } else if (e.topics[0] === "burn") {
    // Handle burn
    const burn = e.decodedData as BurnMetadata;
    console.log(`Burned ${burn.amount} from ${burn.from}`);
  }
}
```

---

## Migration & Backward Compatibility

### Classic Assets (Horizon-Only Path)

Existing code consuming `PaymentEvent` from Horizon will **not be affected**.
CAP-67 SAC events are delivered alongside classic events but do not replace them.

### Dual-Mode Bridged Assets

If a contract implementation chooses to mirror transactions to Horizon (e.g., for
compatibility), the same logical transfer may appear as both:
- A `ContractEmittedEvent` (Soroban source of truth)
- A `PaymentEvent` (Horizon legacy path)

Consumers should de-duplicate or choose one source based on their use case.

---

## Appendix: NormalizedEvent Type Reference

This mapping targets the discriminated union defined in
`packages/pulse-core/src/index.ts` (lines 415–435):

```typescript
export type NormalizedEvent = (
  | PaymentEvent              // payment.received, payment.sent, payment.self
  | AccountOptionsEvent       // account.options_changed
  | AccountCreatedEvent       // account.created
  | TrustlineEvent            // trustline.added, trustline.removed, trustline.updated
  | AccountMergeEvent         // account.merged
  | OfferEvent                // offer.created, offer.updated, offer.deleted
  | BumpSequenceEvent         // account.bump_sequence
  | DataEvent                 // data.set, data.cleared
  | ClaimableCreatedEvent     // claimable.created
  | ClaimableClaimedEvent     // claimable.claimed
  | LiquidityPoolDepositEvent // lp.deposited
  | LiquidityPoolWithdrawEvent// lp.withdrawn
  | TrustAuthEvent            // trustline.authorized, trustline.deauthorized
  | ContractEvent             // contract.invoked, contract.emitted
) & {
  readonly timestampDate: Date;
  network?: Network;
};
```

CAP-67 events map primarily to `ContractEvent` (specifically
`ContractEmittedEvent` with type discriminant "contract.emitted") and secondarily to
`PaymentEvent` and `TrustAuthEvent` for bridged / legacy compatibility.

---

## References

- [CAP-67: Soroban-native Asset Contract](https://github.com/stellar/core/pull/3801)
- [SEP-0041: Soroban Asset Contract](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md)
- [pulse-core API Documentation](./packages/pulse-core/README.md)
