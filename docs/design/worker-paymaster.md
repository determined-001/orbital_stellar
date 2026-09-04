# Worker Paymaster — Security Design

**Status:** ready for review  
**Issue:** #1044 — 18.9 Fee-bump paymaster: front gas, never hold assets  
**Milestone:** Phase 4 – Workers W0: first-party time-based  
**Affected code:** `packages/worker-core/src/Paymaster.ts`, `packages/worker-core/src/sponsorshipPolicy.ts`

---

## 1. Purpose

A Stellar fee-bump transaction lets one account pay the network fee for a
transaction signed by a different account. The **Paymaster** wraps a
user-signed inner transaction in a fee-bump envelope the operator signs and
submits. The user pays nothing in XLM; the operator fronts the fee.

This is useful for workers in two scenarios:

- **Sponsored user actions** — a worker triggers an action on behalf of a user
  whose account may not hold enough XLM for the fee.
- **Fee price management** — the operator can set a higher base fee to improve
  confirmation priority without requiring the user to re-sign.

---

## 2. The absolute rule

> **The operator pays XLM from its own account and gains no authority over
> anything inside the inner transaction.**

This rule is derived from Stellar's fee-bump semantics (CAP-0015 §C.1, §C.2
rule 2). In a fee-bump envelope:

- The outer `feeSource` account is debited the fee.
- The inner transaction executes with the inner `sourceAccount`'s sequence
  number and signing authority exactly as if it had been submitted directly.
- The `feeSource` signs only the outer envelope. That signature means *"I
  agree to pay this fee"* — it confers zero authority over the inner
  transaction's operations.

No Stellar protocol change can make the operator's outer signature affect the
inner transaction. This is a protocol guarantee, not a convention.

---

## 3. What the Paymaster never does

| Prohibition | Why |
|---|---|
| Never holds user assets | The paymaster account only needs a small XLM balance for fees; it has no other role. |
| Never requires the user's secret key | The user signs the inner transaction independently; the paymaster receives only the signed XDR. |
| Never wraps a transaction whose source is the operator | This would let an untrusted caller use the paymaster as a proxy signer for the operator's own sequence number. `SelfWrapError` is thrown immediately. |
| Never wraps a `FeeBumpTransaction` as the inner tx | The protocol prohibits nesting fee bumps (§C.2 rule 2); attempting it throws `InvalidInnerTransactionError`. |
| Never wraps an unsigned transaction | A transaction with no signatures is not a complete user intent; `InvalidInnerTransactionError` is thrown. |

If any of the above checks would pass due to a logic error in calling code, the
construction method throws a distinct, typed error before touching the Stellar
SDK. **If you ever find yourself needing the user's signing key to make the
paymaster work, that is the design bug the PRD warns about. Stop.**

---

## 4. Transaction flow

```
User                          Operator / Worker
────                          ─────────────────
1. Build & sign inner tx
   (user's account, user's key)
2. Send signed XDR ──────────► 3. Paymaster.bump(innerXdr, baseFee)
                                    a. Parse + validate inner XDR
                                    b. Assert inner.source ≠ operator
                                    c. SponsorshipPolicy.check()
                                    d. buildFeeBumpTransaction(operator, baseFee, inner)
                                    e. feeBump.sign(operatorKeypair)
                                    f. SponsorshipPolicy.record()
                                    g. Return signed fee-bump XDR
                               4. POST /transactions → Horizon
```

The inner transaction's XDR — including all user signatures — is embedded
verbatim in the outer envelope. The Stellar SDK preserves the inner envelope
byte-for-byte; a test in `Paymaster.test.ts` asserts this invariant explicitly:

```ts
expect(feeBump.innerTransaction.toEnvelope().toXDR("base64")).toBe(innerXdrBefore);
```

---

## 5. Spend controls — SponsorshipPolicy

An unbounded paymaster is a free XLM faucet. The `SponsorshipPolicy` class
enforces three independent spend-control axes evaluated before every bump.

### 5.1 Per-user rate limit

| Parameter | Default | Purpose |
|---|---|---|
| `maxBumpsPerUserPerWindow` | 10 | Max bumps per user in the window |
| `windowMs` | 60 000 ms | Rolling window length |

Implemented as a per-user sliding-window counter. Timestamps outside the
window are evicted on each check. Throws `RateLimitedError` with a
`retryAfterMs` field when the quota is exceeded.

### 5.2 Per-bump fee cap

| Parameter | Default | Purpose |
|---|---|---|
| `maxFeePerBump` | 10 000 stroops | Max base fee per bump |

Prevents a caller from constructing a transaction with an artificially high
fee to drain the operator float quickly. Throws `FeeTooHighError` if
`baseFee > maxFeePerBump`.

### 5.3 Daily XLM ceiling

| Parameter | Default | Purpose |
|---|---|---|
| `dailyXlmCeiling` | 10 XLM | Max XLM sponsored per UTC calendar day |

Resets at UTC midnight. Throws `FloatExhaustedError` when the ceiling is
reached.

### 5.4 Float exhaustion — must be loud

`FloatExhaustedError` is **never silently swallowed**. A quiet paymaster
failure looks identical to a worker miss from the outside and corrupts the
phase-19 reputation data. Operators must:

1. Wire `FloatExhaustedError` to a PagerDuty/OpsGenie alert or equivalent.
2. Monitor `paymaster.spendSnapshot.dailySpentXlm` via a metrics endpoint.
3. Top up the paymaster account and/or raise `dailyXlmCeiling` before the
   alert clears.

Recommended alerting pattern:

```ts
try {
  const result = paymaster.bump(input);
  await horizon.submitTransaction(result.feeBumpXdr);
} catch (err) {
  if (err instanceof FloatExhaustedError) {
    await alert.critical("paymaster float exhausted", {
      dailySpentXlm: err.dailySpentXlm,
      ceilingXlm: err.ceilingXlm,
    });
  }
  throw err; // re-throw so the worker marks this window as failed
}
```

---

## 6. Key management

- The paymaster account is a **dedicated keypair** separate from any account
  that holds user assets or has signing authority over user accounts.
- The secret key should be stored in a secrets manager (AWS Secrets Manager,
  Vault, etc.) and injected at runtime. It must not be committed to source
  control or appear in logs.
- On mainnet, apply `secretPolicy.ts` / `assertRestrictedSecretNetwork` to
  prevent the key from being used in demo or CI paths.
- Rotate the key by:
  1. Generating a new keypair and transferring the XLM float to the new account.
  2. Updating the secret in the secrets manager.
  3. Restarting workers with the new key.
  4. The old account can be merged after all in-flight fee bumps settle.

---

## 7. Threat model

| Threat | Mitigation |
|---|---|
| Caller passes operator's own account as inner source | `SelfWrapError` thrown before SDK is touched |
| Caller passes a fee-bump tx as inner (protocol nesting) | `InvalidInnerTransactionError` thrown |
| Caller passes unsigned inner tx | `InvalidInnerTransactionError` thrown |
| Caller constructs high-fee tx to drain float quickly | `FeeTooHighError` per `maxFeePerBump` |
| Caller bombards paymaster to drain float | `RateLimitedError` per user, `FloatExhaustedError` as hard daily stop |
| Operator key leaks | Leaking the paymaster key gives an attacker control of the fee float only — no user assets are at risk because the paymaster account holds only XLM for fees |
| Paymaster silently drops bumps when float is low | `FloatExhaustedError` is loud; callers must propagate it |
| Inner transaction modified by paymaster | Impossible: SDK embeds the exact bytes of the inner envelope; byte-identity assertion in tests |

---

## 8. Protocol references

- [CAP-0015: Sponsored Reserves](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md)
- [CAP-0021: Generalized Transaction Fees](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0021.md) — defines fee-bump semantics
- Stellar Developer Docs: [Fee-bump transactions](https://developers.stellar.org/docs/learn/fundamentals/transactions/fee-bump-transactions)

---

## 9. Open questions for review

1. **Policy persistence** — `SponsorshipPolicy` is currently in-memory. In a
   multi-process deployment rate-limit and daily-spend counters are per-process.
   Should the policy plug into `WorkerStateStore` for cross-process spend
   tracking? (Suggested for Phase 4 W1, not a blocker for W0.)

2. **Sequence number exhaustion** — the paymaster does not check whether the
   inner transaction's sequence number is expired. Horizon will reject it; the
   question is whether the worker should catch and classify that error
   explicitly.

3. **Mainnet ceiling defaults** — the default `dailyXlmCeiling` of 10 XLM is
   appropriate for testnet / early W0. Operators deploying on mainnet should
   set this explicitly based on expected worker throughput.
