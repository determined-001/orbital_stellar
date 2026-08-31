# Off-chain-computation trigger class

Design note for issue 20.7, the third trigger class from §C.1: run when an
external result lands — an oracle resolves and settlement must execute, a model
finishes an analysis and a position must change.

The issue is labelled `needs-design` and `type:security`, and its implementation
notes say the label clears on this note: *"Decide the attestation model before
writing code."* It is also the file the issue's own affected-files list names.
No code is written here, and `packages/worker-core` is not scaffolded.

This class is where verifiability gets hard, because **the condition is not on
chain**. Everything below follows from taking that seriously rather than
working around it.

---

## 1. The problem in one paragraph

19.1 verifies workers from the chain: condition observed at ledger N, expected
invocation by N+k, did it occur. That reasoning needs the *condition* to be
reconstructible from chain data. An off-chain condition is not. So without
something extra, every window of this trigger class is `unverifiable` — and the
[verdict taxonomy](./worker-verification-verdicts.md) says `unverifiable`
windows are excluded from reputation, which would make this trigger class
permanently unscoreable.

The attestation model is what moves those windows back into scoreable
territory. It cannot make the condition on-chain, but it can put **evidence that
the condition held** on chain, signed by a source the manifest declared in
advance.

---

## 2. What "attested" has to mean

An attestation that a verifier can only take on faith is not evidence, so the
model must satisfy four properties. Each rules out an easier design.

1. **Signed by a source declared in the manifest, before the fact.** The
   worker's manifest names the permitted computation sources (their public
   keys). An attestation signed by anyone else is not merely invalid — it is a
   registration violation. Declaring the source afterwards would let an operator
   pick whichever source agreed with what they did.
2. **Bound to the specific window.** The attestation names the condition it
   asserts and the window it is for. Without that binding, one genuine
   attestation is replayable across every future window — the operator fires
   whenever they like and re-presents last month's signature.
3. **Recorded with, or referenced by, the invocation.** The chain must record
   *why* the worker fired. An attestation held only by the operator and
   produced on request is a self-reported log with a signature on it, which is
   the thing 19.1 exists not to trust.
4. **Verifiable without contacting the source.** Verification runs over
   historical ledger ranges, possibly long after the source has rotated keys or
   gone away. A model requiring a live callback to the oracle is not replayable,
   and §5 of the verdict taxonomy forbids it outright.

Property 3 is the expensive one and the one worth defending: it is what
separates this design from "trust the operator, but with extra steps."

---

## 3. Reusing the existing attestation model

The issue asks to *"reuse `packages/abi-registry/src/attestation.ts` if its
signature model fits rather than introducing a second attestation concept."*

**The signature model fits. The document type does not.** Reading the module:

| Piece | Fits? | Why |
| ----- | ----- | --- |
| `AttestationEnvelope` — `{ payload, publicKey, signature }` | **Yes** | Exactly properties 1 and 4: a self-contained ed25519 proof of who signed what, verifiable offline. |
| `canonicalizeAttestation` — recursively key-sorted JSON | **Yes** | *"a verifier must be able to re-derive the exact bytes that were signed"* — the same requirement, for the same reason. |
| `verifyAttestation` rules 1–3 | **Yes** | Well-formed `G…` address, envelope signer matches `payload.attester`, valid signature over the canonical bytes. |
| `AttestationDocument` | **No** | It attests *"here is the event schema this deployed contract emits"*: `contractId`, `executableKind`, `wasmHash`, `events: EventSpec[]`. None of it describes an oracle result. |
| `verifyAttestation` rule 4 (`expectedWasmHash`) | **No** | Contract-specific by construction. |

So the correct move is neither "reuse as-is" nor "write a second attestation
concept". It is to **extract the envelope**.

The module's own docstring says it is already nearly there: *"everything here is
shape-agnostic (it only reads `attester`, `executableKind`, and `wasmHash`
directly, and otherwise treats the document as an opaque value to
canonicalize/sign/verify)."* Two of those three reads are the contract-specific
rule 4.

**Proposal.** Make the envelope generic over its payload, with `attester` the
only field it requires:

```ts
interface SignedEnvelope<TPayload extends { attester: string }> {
  payload: TPayload;
  publicKey: string;   // G…
  signature: string;   // base64 ed25519 over canonicalize(payload)
}
```

`signAttestation` / `verifyAttestation` keep their current signatures as the
ABI-specific specialisation, with the `expectedWasmHash` check layered on top as
it is today. Nothing about the existing API changes for existing callers, and
20.7 gets one attestation concept rather than a second.

**Where it lives.** `abi-registry` is the wrong home for a generic signing
envelope once a second consumer exists, and `worker-core` importing
`abi-registry` for signature verification is a dependency that will read as
accidental in six months. Two options, both acceptable, and a reviewer should
pick one now rather than after the import lands: move the envelope into
`pulse-core` (already a shared dependency), or a small
`@orbital-stellar/attest` package. This note prefers the former — one fewer
package, and `pulse-core` is already where cross-cutting primitives live.

### 3.1 The computation attestation document

```ts
type ComputationAttestation = {
  attester: string;          // G… — must be in the manifest's declared sources
  workerId: string;          // which worker definition this is for
  windowId: string;          // property 2: binds the attestation to one window
  conditionId: string;       // which declared condition of that worker
  observedAt: string;        // ISO 8601 — when the source observed the result
  result: unknown;           // the computation's output, opaque to the envelope
  resultHash: string;        // hex SHA-256 of the canonicalized result
  expiresAt?: string;        // optional validity bound
};
```

`workerId` + `windowId` + `conditionId` are property 2. `resultHash` exists so
the *invocation* can reference the attestation compactly (§4) without carrying
the whole result on chain.

Mirroring `AttestationDocument`'s existing conventions: `G…` addresses,
hex-encoded SHA-256, ISO 8601 timestamps, and an optional expiry — the same
validation regexes in `types.ts` apply.

---

## 4. Getting it onto the chain

Property 3 says the chain records why the worker fired. Two shapes, and the
manifest declares which a worker uses:

**Reference (default).** The invocation carries `resultHash` and the attester's
key. The full attestation is published off-chain at a location the manifest
declares, addressed by that hash. Cheap, and the hash is what actually binds —
a stored attestation that does not hash to the on-chain value is detectably
substituted.

**Inline.** The invocation carries the full attestation. Correct when the result
is small and the contract itself consumes it (a settlement price the contract
must act on). More expensive; unavoidable when the contract needs the value.

The reference form has a real weakness that must be stated rather than papered
over: **if the off-chain attestation becomes unavailable, the window becomes
`unverifiable` retroactively.** The hash proves nothing about a document nobody
can produce. That is the honest outcome — it is not a `missed`, and it is not a
success. It also gives the operator a clear, self-interested reason to keep
attestations retrievable, which is a better incentive than a rule.

---

## 5. What verification does with all this

Extending the [verdict taxonomy](./worker-verification-verdicts.md), which
already reserves `unverifiable` for exactly this class:

| Situation | Verdict | Reason |
| --------- | ------- | ------ |
| Valid attestation from a declared source, bound to the window; invocation within the bound | `fired` | — |
| As above, invocation after the bound | `late` | with `latencyLedgers` |
| Valid attestation, no invocation by the deadline | `missed` | the condition demonstrably held and nothing happened |
| No attestation on chain for the window | `unverifiable` | `no-attestation` |
| Attestation present but signature invalid, or signer not a declared source | `unverifiable` | `attestation-invalid` — **and an alert** |
| Attestation references a result nobody can produce | `unverifiable` | `attestation-unretrievable` |
| Attestation for a different window (replay) | `unverifiable` | `attestation-window-mismatch` — **and an alert** |

Three things this table is deliberately doing:

- **`missed` is reachable.** An attested condition that demonstrably held, with
  no invocation, is a real miss and must score as one. Otherwise this trigger
  class is a way to opt out of accountability, which is the failure mode the
  issue names.
- **An invalid attestation is `unverifiable`, not `missed`.** It is evidence of
  a broken or malicious *source*, not of a sleeping worker, and the two need
  different responses. But it is also not benign, hence the alert — silently
  filing it with honest `no-attestation` windows would hide an attack (§6).
- **`unverifiable` windows are excluded from reputation, never counted as
  successes.** Inherited verbatim from the taxonomy. The implementation note is
  blunt about why: *"Silently scoring unverifiable windows as successes turns
  the reputation score into a number operators can inflate by choosing
  unverifiable triggers."* The disclosure rule matters as much as the exclusion
  — a worker whose windows are 90% `unverifiable` must present that count
  beside its score, or exclusion becomes a quiet way to launder a bad record.

---

## 6. Security review: a malicious or compromised source

The issue requires this explicitly (`type:security`). Six threats.

**T1 — A source signs a condition that never held.** Not preventable. An
attestation is a *statement by a named party*, and cryptography proves who said
it, not whether it was true. The mitigations are containment: the source is
named in the manifest and in every verdict's evidence, so a false attestation is
attributable; and a subscriber choosing a worker can see which sources it
trusts before subscribing. **This must be stated in operator-facing docs.** A
model that reads as "the chain verified the condition" when it verified a
signature would be worse than no attestation at all, because it would be
believed.

**T2 — Key compromise.** The declared key signs attestations the source never
made. Mitigations: `expiresAt` bounds the blast radius; key rotation is a
manifest change, so the window during which a compromised key was declared is
itself on the record; and verification uses **the manifest as of the window's
ledger**, so rotating a key does not retroactively invalidate honest history or
retroactively validate a forged past.

**T3 — Replay across windows.** Closed by construction — `windowId` binds an
attestation to one window and a mismatch is `attestation-window-mismatch` plus
an alert.

**T4 — Operator selects a favourable source.** An operator declaring five
sources and presenting whichever agreed with what they did. Mitigation: the
manifest declares, per condition, **which** source is authoritative — not a set
to choose from at fire time. Multiple sources are a quorum rule fixed in advance
(e.g. 2-of-3, with the rule in the manifest), never a menu.

**T5 — Withholding.** An operator possessing a valid attestation, not firing,
and not publishing it — turning a `missed` into an `unverifiable`. This is the
threat with no clean cryptographic answer, because absence of evidence is what
both look like. Partial mitigation: sources publish attestations independently
of the operator, so withholding requires the source's cooperation. Where the
source does publish independently, a withheld window is detectable and scores as
`missed`. Where it does not, the exclusion-plus-disclosure rule is the backstop
— an operator whose `unverifiable` rate is anomalous is visible, even if no
single window can be proven.

**T6 — Source availability as a denial of service.** A source going down makes
subsequent windows `unverifiable`, damaging a worker's disclosed reliability
without the operator doing anything wrong. Accepted rather than solved: it is a
real cost of choosing this trigger class, and it should be documented so an
operator weighs it before registering. The quorum rule in T4 also mitigates it.

---

## 7. Positioning against Reflector Subscriptions

Required by the acceptance: *"Reflector Subscriptions already offers
price-threshold triggers with webhook notification (§C.8) and overlaps this use
case. Position deliberately rather than by accident."*

The overlap is real and narrower than it looks. Reflector Subscriptions is a
**price oracle with notification**: a subscriber declares a price threshold and
is told when it is crossed. That is a first-class product for the price-feed
case, and this note does not propose competing with it.

The differences that matter here:

- **Notification versus execution.** A webhook tells you the condition held.
  Something still has to build, sign and submit the transaction, and be
  accountable for having done so. This trigger class is about that second half.
- **Verifiability of the firing.** A webhook leaves no record that the recipient
  acted on it. The whole point of §2's property 3 is that the chain records why
  a worker fired, which is what makes 19.1 able to score it.
- **Condition generality.** Reflector's conditions are price thresholds. This
  class is any external computation — a model output, a settlement confirmation,
  an off-chain match.

**Therefore: compose, do not compete.** Reflector is an excellent *declared
computation source* under §3.1, if it signs its results in a form that satisfies
§2. The design should treat a price-threshold trigger as the case where the
attester is Reflector, rather than reimplementing price feeds. A worker whose
condition is purely a price threshold and whose source is Reflector should be
routed there in documentation, not absorbed.

**Open question for review:** whether Reflector's current notification payload
carries a signature that satisfies §2 as-is, or whether an adapter is required.
This note does not assert either — that needs checking against their live API,
and asserting it from memory is exactly the kind of claim this design should not
make.

---

## 8. Registration-time gates

Consistent with 20.6's rejection of trade-signal conditions, registration
refuses a worker in this class unless:

- Every off-chain condition names its authoritative source (or quorum rule, per
  T4) with a `G…` key.
- Each declares an attestation shape (reference or inline, §4) and, for
  reference, a retrieval location.
- Each declares a latency bound, so `late` is measurable (19.1 §2.1).

Refusing at registration rather than warning is what keeps the taxonomy honest:
a worker that cannot produce verifiable windows should not be able to accrue a
reputation score composed entirely of exclusions.

---

## 9. What this note does not decide

- **The attestation retrieval protocol** (§4, reference form) — a URL in the
  manifest, a content-addressed store, or something else.
- **Quorum semantics beyond "declare it in advance"** (T4) — thresholds and
  disagreement handling need 20.6's predicate work first.
- **Whether Reflector's payload is directly usable** (§7) — needs verification
  against their live API, not assertion.
- **The `worker-core` module layout.** The issue's affected-files list names
  `triggers/computationTrigger.ts` and `triggers/attestation.ts`; that is
  implementation, and it follows 20.6 which follows 19.1.

---

## Review checklist

`needs-design` clears on agreement, not on merge:

1. Is extracting a generic `SignedEnvelope` from `abi-registry` (§3) the right
   reuse, and does it live in `pulse-core` or a new package?
2. Is the `ComputationAttestation` shape (§3.1) sufficient — in particular, is
   `windowId` binding enough to close replay?
3. Is the verdict mapping in §5 right, especially `missed` being reachable and
   an invalid attestation being `unverifiable`-plus-alert?
4. Is T5 (withholding) acceptably mitigated, or does it need a protocol answer?
5. Is "compose with Reflector rather than compete" (§7) the intended position?
