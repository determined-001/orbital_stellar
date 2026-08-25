# Anchor lifecycle taxonomy

Off-chain anchor state and on-chain settlement are two views of one payment. If
they arrive as two unrelated event shapes, every consumer writes its own
correlation logic — and gets it subtly wrong. This document defines how SEP-24
and SEP-31 transactions map into the `NormalizedEvent` union in
`@orbital-stellar/pulse-core`.

Implements issue 14.3. The mapping lives in
`packages/anchor-sdk/src/normalizeAnchorEvent.ts`.

---

## The shape

```ts
type AnchorFlowEvent = {
  type: "anchor.deposit.completed";       // normalized lifecycle event
  protocol: "sep24" | "sep31";
  stage: "initiated" | "pending" | "completed" | "refunded" | "failed";
  transactionId: string;
  protocolStatus: Sep24Status | Sep31Status; // the anchor's own status, verbatim
  anchorUrl: string;
  settlementTxHash: string | null;        // published hash, or null
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  message?: string;
  timestamp: string;
  readonly timestampDate: Date;
  raw?: unknown;
};
```

Three families, five stages each:

| Family | Source | Covers |
|---|---|---|
| `anchor.deposit.*` | SEP-24 `kind: "deposit"` | fiat/external → Stellar |
| `anchor.withdrawal.*` | SEP-24 `kind: "withdrawal"` | Stellar → fiat/external |
| `anchor.payment.*` | SEP-31 | sending anchor → receiving anchor |

Stages: `initiated`, `pending`, `completed`, `refunded`, `failed`.

---

## Two rules

**1. The normalization never replaces the anchor's own status.**

`type` is a convenience for consumers that only care whether a flow is done.
`protocolStatus` carries what the anchor actually said, unmodified. A compliance
consumer reads `protocolStatus`; a dashboard reads `type`. Collapsing
`too_small`, `too_large`, `no_market`, `expired` and `error` into
`anchor.*.failed` is lossy on purpose — and losslessly recoverable, because the
original is right there on the event.

**2. `settlementTxHash` is only ever a hash the anchor published.**

When the anchor exposes `stellar_transaction_id`, it is copied through. When it
does not, the field is **explicitly `null`** — never inferred from timing, never
looked up by scanning Horizon for a payment of the right amount around the right
moment. A correlation invented from timing is indistinguishable from a
fabricated one, and this is payment data.

The field is always present, so a consumer can distinguish "the anchor gave us
no hash" (`null`) from "this event shape does not model settlement" (absent).

---

## SEP-24 status → event

`kind` selects the family (`deposit` or `withdrawal`); the status selects the
stage. Both columns below apply to `anchor.deposit.*` and `anchor.withdrawal.*`.

| SEP-24 status | Stage | Event | Notes |
|---|---|---|---|
| `incomplete` | `initiated` | `anchor.{kind}.initiated` | Anchor accepted the request; user has not finished the interactive flow |
| `pending_user_transfer_start` | `pending` | `anchor.{kind}.pending` | Waiting for the user to send funds |
| `pending_user_transfer_complete` | `pending` | `anchor.{kind}.pending` | User sent; anchor has not credited yet |
| `pending_external` | `pending` | `anchor.{kind}.pending` | Waiting on an external rail (bank, card network) |
| `pending_anchor` | `pending` | `anchor.{kind}.pending` | Anchor is processing |
| `pending_stellar` | `pending` | `anchor.{kind}.pending` | Stellar transaction submitted, not yet final |
| `pending_trust` | `pending` | `anchor.{kind}.pending` | Waiting for the user to establish a trustline |
| `pending_user` | `pending` | `anchor.{kind}.pending` | Waiting on user action (KYC, confirmation) |
| `completed` | `completed` | `anchor.{kind}.completed` | Terminal |
| `refunded` | `refunded` | `anchor.{kind}.refunded` | Terminal; funds returned |
| `expired` | `failed` | `anchor.{kind}.failed` | Terminal; `protocolStatus` keeps the reason |
| `no_market` | `failed` | `anchor.{kind}.failed` | Terminal |
| `too_small` | `failed` | `anchor.{kind}.failed` | Terminal; below the anchor's minimum |
| `too_large` | `failed` | `anchor.{kind}.failed` | Terminal; above the anchor's maximum |
| `error` | `failed` | `anchor.{kind}.failed` | Terminal |

## SEP-31 status → event

| SEP-31 status | Stage | Event | Notes |
|---|---|---|---|
| `pending_sender` | `initiated` | `anchor.payment.initiated` | Receiving anchor is waiting for the sending anchor to submit |
| `pending_transaction_info_update` | `pending` | `anchor.payment.pending` | Receiving anchor needs corrected fields |
| `pending_stellar` | `pending` | `anchor.payment.pending` | Payment submitted to Stellar |
| `pending_receiver` | `pending` | `anchor.payment.pending` | Receiving anchor is processing |
| `pending_external` | `pending` | `anchor.payment.pending` | Waiting on an external rail |
| `completed` | `completed` | `anchor.payment.completed` | Terminal |
| `error` | `failed` | `anchor.payment.failed` | Terminal |

SEP-31 has no `refunded` status, so `anchor.payment.refunded` exists in the type
union but is not currently produced by `normalizeSep31Status`. It is kept so the
three families share one stage vocabulary; if SEP-31 gains a refund state, the
mapping is the only thing that changes.

---

## Correlating to on-chain settlement

When `settlementTxHash` is non-null, it is the Stellar transaction hash the
anchor reported. The intended pattern is to join it against the on-chain event
stream:

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const settlements = new Map<string, string>(); // txHash -> anchor transactionId

// From the anchor side
if (anchorEvent.settlementTxHash) {
  settlements.set(anchorEvent.settlementTxHash, anchorEvent.transactionId);
}

// From the chain side
watcher.on("payment.received", (event) => {
  const anchorTransactionId = settlements.get(event.raw?.transaction_hash ?? "");
  if (anchorTransactionId) {
    // Same payment, two views.
  }
});
```

If `settlementTxHash` is `null`, there is no correlation to make. The honest
answer is to show the flow as unlinked rather than to guess.

---

## Relationship to `anchor.transaction_status_changed`

The earlier single event `anchor.transaction_status_changed` (shipped in #942)
is deprecated. It forced consumers to branch on `protocol` plus a raw status
string, carried snake_case fields inconsistent with the rest of the taxonomy,
and had no settlement field at all. It remains in the union so existing
narrowing keeps compiling, and is scheduled for removal before `v2.0.0`.
