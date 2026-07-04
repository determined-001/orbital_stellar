# #623 — Discriminated union refinement: narrow event.raw

**Status:** Already implemented on `main`. This branch (`refactor/623-narrow-event-raw`) is
identical to `main` — the entire feature was completed in three earlier commits.

---

## What was done

### 1. RawHorizon{OperationType} interfaces

**File:** `packages/pulse-core/src/raw-horizon.ts` (146 lines)

Defines `RawHorizonBaseOperation` and 13 per-operation interfaces:

| Interface | Operation |
|---|---|
| `RawHorizonPayment` | `payment` |
| `RawHorizonSetOptions` | `set_options` |
| `RawHorizonCreateAccount` | `create_account` |
| `RawHorizonManageSellOffer` | `manage_sell_offer` |
| `RawHorizonManageBuyOffer` | `manage_buy_offer` |
| `RawHorizonBumpSequence` | `bump_sequence` |
| `RawHorizonManageData` | `manage_data` |
| `RawHorizonChangeTrust` | `change_trust` |
| `RawHorizonAccountMerge` | `account_merge` |
| `RawHorizonCreateClaimableBalance` | `create_claimable_balance` |
| `RawHorizonClaimClaimableBalance` | `claim_claimable_balance` |
| `RawHorizonLiquidityPoolDeposit` | `liquidity_pool_deposit` |
| `RawHorizonLiquidityPoolWithdraw` | `liquidity_pool_withdraw` |
| `RawHorizonAllowTrust` | `allow_trust` |
| `RawHorizonSetTrustLineFlags` | `set_trust_line_flags` |

### 2. RawSorobanEvent

**File:** `packages/pulse-core/src/raw-soroban.ts` (12 lines)

Defines `RawSorobanEvent` for Soroban contract events.

### 3. Event types narrowed to specific `raw` interfaces

**File:** `packages/pulse-core/src/index.ts` — each event type now carries the correct raw type:

| Event type | `raw` type | Lines |
|---|---|---|
| `PaymentEvent` | `RawHorizonPayment` | 190 |
| `AccountOptionsEvent` | `RawHorizonSetOptions` | 206 |
| `OfferEvent` | `RawHorizonManageSellOffer \| RawHorizonManageBuyOffer` | 218 |
| `BumpSequenceEvent` | `RawHorizonBumpSequence` | 226 |
| `ClaimableCreatedEvent` | `RawHorizonCreateClaimableBalance` | 242 |
| `ClaimableClaimedEvent` | `RawHorizonClaimClaimableBalance` | 250 |
| `DataEvent` | `RawHorizonManageData` | 262 |
| `LiquidityPoolDepositEvent` | `RawHorizonLiquidityPoolDeposit` | 277 |
| `LiquidityPoolWithdrawEvent` | `RawHorizonLiquidityPoolWithdraw` | 287 |
| `TrustAuthEvent` | `RawHorizonAllowTrust \| RawHorizonSetTrustLineFlags` | 298 |
| `AccountCreatedEvent` | `RawHorizonCreateAccount` | 316 |
| `TrustlineEvent` | `RawHorizonChangeTrust` | 334 |
| `AccountMergeEvent` | `RawHorizonAccountMerge` | 350 |
| `ContractInvokedEvent` | `RawSorobanEvent` | 538 |
| `ContractEmittedEvent` | `RawSorobanEvent` | 569 |

### 4. EventEngine uses typed casts

**File:** `packages/pulse-core/src/EventEngine.ts`

Every `normalize*` method casts the raw record to the correct `RawHorizon*` type (lines
1112, 1146, 1221, 1243, 1259, 1300, 1327, 1382, 1435, 1461, 1503, 1540, 1565, 1601,
1620, 1651, 1690, 1709).

### 5. Exhaustive switch type tests

**File:** `packages/pulse-core/test/pulse-core.test.ts` lines 2174–2255

Runtime test `"narrows event.raw successfully using an exhaustive switch"` covers every
`NormalizedEvent` type and asserts `event.raw` narrows correctly per branch.

**File:** `packages/pulse-core/test/types.exhaustive.test-d.ts` (68 lines)

Compile-time `never` exhaustiveness check — omitting a variant from the switch produces
a build error. Includes both a positive (all branches handled) and negative
(`@ts-expect-error` with incomplete switch) test.

**File:** `packages/pulse-core/test/types.contract.test-d.ts` (75 lines)

Compile-time checks that `ContractInvokedEvent["raw"]` and `ContractEmittedEvent["raw"]`
resolve to `RawSorobanEvent`.

**File:** `packages/pulse-core/src/eventAddressNarrow.ts` (105 lines)

Utility `describeEvent()` using an exhaustive switch over `NormalizedEvent`, with
`never` fallback demonstrating the narrowing works for downstream consumers.

---

## Key commits

| Commit | Description |
|---|---|
| `d5858f9` | Initial raw interfaces + narrowed types in `index.ts` + casts in `EventEngine` + runtime test |
| `8f58320` | Compile-time exhaustive switch type test (`types.exhaustive.test-d.ts`) + CI wiring |
| `70c5ab7` | Branded address types + `eventAddressNarrow.ts` utility with exhaustive switch |

---

## Verification

```bash
# Type tests pass
npx tsc --noEmit -p packages/pulse-core/tsconfig.json
npx tsc --noEmit -p packages/pulse-core/tsconfig.typetest.json

# Runtime tests pass (4 failures are pre-existing fast-check missing deps, unrelated)
npx vitest run
```
