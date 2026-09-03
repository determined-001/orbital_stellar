# Backstop — regulatory framing & characterization position

**Issue:** #1066 (21.5) · **Milestone:** Phase 4 — Workers W3: backstop
**Type:** maintainer-only position document (docs, not implementation)
**Status:** DRAFT — position for internal alignment. Must land before 21.6 and before any public pricing copy.
**Date:** 2026-08-29
**Owner:** maintainers
**Counsel review:** **Not yet performed.** This document is a maintainer-authored draft. It is *not* legal advice and does *not* substitute for review by qualified insurance/regulatory counsel in each in-scope jurisdiction. Publication and 21.6 pricing copy are blocked on that review (see [Counsel review record](#counsel-review-record)).

---

## 0. Why this document exists, and why the order matters

§C.7 flags the risk directly: a fee that is explicitly priced against *another
party's failure* sits close to insurance regulation in several jurisdictions, and
regulated-money customers' compliance teams will ask about it. The instruction in
21.5 is deliberately sequenced **before** the pricing page (21.6) and before any
customer-facing commitment: if we write marketing copy first and a regulatory
position later, we end up rewriting public promises under time pressure, and the
two characterizations can drift apart.

The hard rule this document enforces: **there is one characterization, used
identically in internal docs and in customer-facing copy.** We do not describe the
backstop as insurance in marketing while calling it a discretionary mutual
internally, or vice versa.

---

## 1. Position — how the backstop is characterized, and why

**The backstop is characterized as a discretionary mutual backstop, not insurance.**

Concretely:

- Subscribers pay a fee into a pooled fund. Most subscribers never draw on it.
  The pool funds intervention for the minority whose covered failure actually
  occurs. That is the *mechanic* of mutual risk-sharing, not the *contract* of
  insurance.
- Cover is **discretionary**: the backstop acts when its stated conditions are
  met, per the published rules, but it is not a guaranteed indemnity contract
  promising to make any subscriber whole for any defined loss. The published
  terms (see `docs/legal/terms-backstop.md`) describe what is and is not promised.
- We do **not** use insurance language that implies a regulated contract of
  indemnity: no "policyholder," no "premium" in the insurance-law sense, no
  "claim paid under a policy," no promise to "make you whole." Where marketing
  copy is written, it uses the same words as this document and the ToS.

**Why this characterization:** it matches the product's actual mechanics (pooled
fees from many, intervention for the few), it tracks established prior art (Nexus
Mutual's discretionary mutual, §3), and it keeps the product outside the
contract-of-indemnity perimeter that triggers licensing as an insurer in the
jurisdictions we have considered (§4). Characterizing it as insurance would pull
the product into licensing, solvency, and conduct regimes we are not structured to
meet, and would contradict the discretionary nature of the mechanism.

> Single source of truth: `docs/legal/terms-backstop.md` is the operative
> definition. Every other surface (pricing page, docs, onboarding) must quote or
> link it, not re-describe the backstop.

---

## 2. Mechanics, described honestly

The backstop is funded by fees collected from subscribers who, statistically, will
rarely need it, and it spends from that pool to fund intervention for the few who
do. We state this plainly because the "many pay, few draw" shape is exactly what
makes the insurance-regulatory question non-trivial — and exactly why we must be
careful not to over-promise.

- **Pooling:** a single fund aggregates subscriber fees. It is not earmarked
  per-subscriber in the way a policy reserve would be.
- **Trigger:** intervention is described in the ToS as occurring when a covered
  failure meets the published conditions. The conditions, not a promise to
  indemnify, are the obligation.
- **Discretion:** the backstop operates within its published rules and available
  pool. It does not guarantee a particular outcome or a particular payout size.
- **No risk transfer in the insurance sense:** subscribers are not buying a
  contract that transfers a defined risk to a regulated insurer in exchange for
  consideration. They are participating in a mutual arrangement governed by the
  published terms.

This is the honest description. Any public copy that implies "we guarantee to
cover your loss" is inconsistent with this document and with the ToS and must be
corrected.

---

## 3. Nexus Mutual — discretionary-cover framing

Nexus Mutual is the most-cited prior art for a discretionary, mutual,
blockchain-native risk pool. Understanding it prevents us from either copying it
uncritically or dismissing the regulatory question it already navigated.

### 3.1 What Nexus Mutual does

- It is structured as a **discretionary mutual** (members are mutual members, not
  policyholders). Cover is **discretionary**: members vote on claims, and there is
  no contract of insurance guaranteeing payment.
- It deliberately avoids the language and legal structure of a licensed insurer in
  the jurisdictions where it operates, characterizing cover as mutual
  discretionary protection rather than an insurance policy.
- Its risk pool is member-funded and member-governed; the mutual, not a
  policyholder contract, is the vehicle.

### 3.2 What transfers to this case

| Element | Transfers? | Notes |
|---|---|---|
| "Discretionary, not a policy" framing | **Yes** | Core of our characterization. |
| Mutual / pooled funding from many, spend on few | **Yes** | Matches our mechanic (§2). |
| Avoidance of insurance-contract language | **Yes** | Drives our single-characterization rule. |
| Member governance / claims voting | **Partial** | We may not replicate token-holder claims voting; our trigger is rule-based, not vote-based. If we add any governance, re-review. |
| Risk-pooling as the substance of the product | **Yes** | This is the part that attracts regulatory attention and must be described honestly. |

### 3.3 What does **not** transfer

| Element | Does not transfer | Why |
|---|---|---|
| Token-holder mutual membership / on-chain governance | No | Our subscribers are customers under ToS, not mutual members with governance rights, unless we deliberately adopt that structure (out of scope for 21.5). |
| Claims adjudicated by member vote | No | Our intervention is rule-triggered, not voted. Different risk: "discretion" here is operational, not governance discretion. Document it. |
| Nexus Mutual's specific jurisdictional carve-outs | No | Their permissions/analysis are theirs and do not extend to us. We must run our own (§4). |
| Implicit assumption that "discretionary mutual" is uniformly accepted everywhere | No | Acceptance of the discretionary-mutual characterization varies by jurisdiction; see §4. |

The lesson from Nexus Mutual is narrow but important: the discretionary-mutual
framing is viable *only* if the mechanics and the language both genuinely match it.
If we keep the discretionary framing but build insurance-like guarantees, we
inherit the insurance regulation without the defensibility.

---

## 4. Jurisdictions

### 4.1 Considered (in scope for this position)

These are the jurisdictions where we have, or expect to acquire, regulated-money
customers, and where the insurance-perimeter question is material:

| Jurisdiction | Regulator / regime | Stance taken in this draft |
|---|---|---|
| **United States** | State insurance regulators (NAIC coordination); potential federal interest | Treated as the strictest bar. A fee priced against another's failure risks classification as insurance (or a "contract of indemnity") under state law. Discretionary-mutual framing + no indemnity language is the defensive position. **Per-state analysis still required before US customers.** |
| **United Kingdom** | FCA; PRA for insurers | "Discretionary mutual" / non-contract-of-insurance framing is the relevant perimeter. FCA consumer-duty expectations still apply to how we describe the product. |
| **European Union** | National competent authorities; Solvency II perimeter | Solvency II applies to (re)insurers. Our position: not an (re)insurer; no risk-transfer contract. National nuances remain. |
| **Switzerland** | FINMA | Similar perimeter logic; FINMA views on collective risk arrangements noted for review. |
| **Singapore** | MAS | MAS insurance regulatory perimeter; discretionary arrangements still scrutinized if they resemble insurance to consumers. |

### 4.2 Not considered (explicitly out of scope)

Naming these prevents the silent assumption that "discretionary mutual" is global:

| Jurisdiction / region | Why not considered (yet) |
|---|---|
| **China** | Crypto/Stellar access restrictions; no current customer footprint. |
| **India** | No current regulated-money customer footprint; IRDAI perimeter not assessed. |
| **Brazil** | No current footprint; SUSEP perimeter not assessed. |
| **Other LATAM / Africa / MENA** | No current footprint; per-market analysis deferred until customer demand exists. |
| **Any jurisdiction where the product is not legally offered** | We do not characterize the backstop for markets we do not serve; the ToS limits availability accordingly. |

This list is **preliminary** and must be confirmed against the actual customer
footprint by the maintainers before publication. "Not considered" means "not
assessed," not "safe."

---

## 5. One characterization — consistency rule

Internal docs (this file, ADRs, design notes) and external copy (pricing page,
marketing, onboarding, support articles) use **identical** language:

> *The backstop is a discretionary mutual backstop funded by subscriber fees. It
> is not insurance and does not guarantee to make any subscriber whole. Intervention
> is described in the published terms.*

Deviations are bugs. If legal counsel later changes the characterization, it
changes **everywhere at once**, via `docs/legal/terms-backstop.md` as the source
of truth.

---

## 6. Not legal advice & counsel review record

**This document is not legal advice.** It is a maintainer-authored position to
align engineering, product, and docs before pricing copy is written. It does not
create any obligation, representation, or warranty.

### Counsel review record

| Field | Value |
|---|---|
| Document version | DRAFT, 2026-08-29 |
| Author | maintainers (drafted with engineering assistance) |
| Insurance/regulatory counsel engaged? | **No — not yet.** |
| Counsel reviewed this position? | **No.** |
| Counsel approved characterization? | **No.** |
| Blocker for 21.6 / public pricing copy? | **Yes.** Do not publish customer-facing backstop commitments until counsel reviews and, if needed, amends this position and `docs/legal/terms-backstop.md`. |
| Re-review triggers | Any change to mechanics (e.g., adding vote-based governance, guaranteed payouts, per-subscriber reserves); any new in-scope jurisdiction; any customer in a "not considered" jurisdiction. |

---

## 7. Open questions for counsel

1. Is the discretionary-mutual framing defensible in each **considered**
   jurisdiction given our *rule-triggered* (not vote-triggered) intervention?
2. Does the "many pay, few draw" mechanic alone risk an insurance characterization
   even without indemnity language?
3. For the **United States**, is a per-state analysis required, and is there a
   safe state to launch in first?
4. Do any considered jurisdictions require consumer-duty disclaimers beyond
   "not insurance"?
5. Should subscribers be mutual members (Nexus-style) or ToS customers? The
   choice changes the regulatory surface materially.
