# Workers: the trigger is not the custodian

Architecture decision record for the worker layer (Phase 4, majors 18–22).

Implements issue 18.13. The constraint recorded here is the one that decides
whether Orbital is running infrastructure or running a custody product, so it
is written down rather than left in a PRD, a chat log, or a file in someone's
Downloads folder — it has to survive contributor turnover and be citable in
review by URL.

> **Status.** The Part C freeze has been lifted in writing (#1036 / #1091), and
> Phase 4 is on [`ROADMAP.md`](../../ROADMAP.md#phase-4--workers-entry-gate).
> `ORBITAL_PRD.md` is still not in this repository, so §C could not be quoted
> verbatim as 18.13 asks. The rules below are reconstructed from the worker
> backlog (18.x–22.x) and from the canonical example in 18.10, and are stated as
> the repository's own position. The maintainer should confirm the wording
> against the PRD and replace this note.

---

## 1. The four rules, in precedence order

Precedence matters: when two rules pull in different directions the lower
number wins. A design that satisfies rule 3 by breaking rule 1 is rejected.

### Rule 1 — A worker triggers. It never custodies.

A worker may cause a contract call to happen. It may not decide where the money
goes. The destination, the amount and the conditions are fixed by the contract
before any worker is involved, and the worker's only input is *when*.

The canonical shape is a permissionless `disburse()` (18.10): the contract
checks "the window has elapsed, the balance is sufficient, the recipient set is
configured" and does not care who called it. Anyone may call it. Calling it
early reverts. Calling it from an arbitrary address when it is due succeeds.

That is the whole argument. If every Orbital worker vanished tomorrow, payroll
runs late and nothing is stolen.

### <a id="c2-no-user-custody"></a>Rule 2 — A worker holds no signing authority over user funds.

Not "holds it carefully". Holds none.

**A design that requires a worker to hold signing authority over a user's
account is a design bug, not a feature.**

A worker's power is limited to *"call a constrained function"*, never *"decide
where money goes"*. This is the whole justification for the worker tiers
existing as a product: if a worker holds the key, what is being sold is custody
wearing a different name, and it should be evaluated — and regulated — as
custody.

> **On the numbering.** The custody gate, the PR template and
> [`vault-pattern.md`](./vault-pattern.md) cite this rule as **§C.2 rule 3**,
> which is the PRD's numbering. This document orders the rules by *precedence*,
> where it is rule 2. Same rule, and the `#c2-no-user-custody` anchor those
> references point at is on this heading and stays there. If the PRD is ever
> brought into the repository, reconcile the two numberings here rather than
> silently renumbering under the existing citations.

**Review rule: if a proposed worker needs signing authority to do its job, the
design is the bug — not the worker.** Send it back to the contract. The
question to ask is never "how do we secure the worker's key" but "why does this
contract require a trusted caller at all". Every answer to the first question is
a custody product with extra steps.

#### Why it is a rule and not a preference

The failure is not gradual. A worker that holds a user's key can, at any moment
and without further consent:

- move funds anywhere, not just to the destinations the user had in mind;
- be compelled to do so by whoever compromises the worker;
- keep doing so after the user believes they have stopped it.

None of those are mitigated by careful code in the worker. They are properties
of holding the key. The only thing that removes them is not holding it.

#### What to do instead

The user deposits into a **constrained Soroban vault** and grants the worker
permission to call one bounded function on it:

- allow-listed pools and assets, set by the depositor and not wideneable by the
  worker;
- a max-slippage bound enforced on chain, so a violating action reverts;
- `withdraw()` that pays **only** the original depositor — no recipient
  parameter exists anywhere in the interface, because a parameter that must be
  checked is a check someone can later relax;
- revocation the depositor can exercise unilaterally and immediately, including
  during an incident.

The vault, not the worker, is where the guarantees live. See
[`vault-pattern.md`](./vault-pattern.md).

### Rule 3 — A worker's absence delays. It never diverts.

The failure mode of the entire layer is lateness. If a worker is offline,
slow, malicious, or gone, the correct outcome is that the action happens later
— when someone else calls it, including the user. It is never that the action
happens wrongly, or that funds land somewhere else.

This is what makes the guarantee cheap to make credibly for time-insensitive
work (21.3) and expensive for anything else, and it is why the tiers are priced
by latency rather than sold as one flat promise.

### Rule 4 — Every authority a worker does hold is removable by its subscriber, unilaterally.

A subscription is a notification and billing relationship (20.5). It carries no
key, no allowance, and no authority over subscriber funds — asserted as a
type-level test rather than a comment, because it is the property a future
contributor is most likely to erode by convenience.

Cancellation takes effect within one window and is auditable. Nothing about
ending a subscription requires the operator's cooperation.

---

## 2. How rule 2 is enforced

Prose gets skimmed. Two mechanical checks answer it instead:

1. **The PR template** carries a custody checklist for any PR touching
   `packages/worker-core/`, `contracts/vault/` or `contracts/payroll/`.
2. **`.github/workflows/custody-gate.yml`** runs
   `scripts/check-no-user-custody.mjs`, which flags new code introducing a
   user-secret or user-keypair field into worker types, subscription records or
   manifests.

### What the check actually matches

Deliberately narrow. A broad heuristic that fires constantly trains reviewers to
click through it, which is worse than no gate:

- a **field declaration** whose name pairs a user-ish owner (`user`,
  `subscriber`, `depositor`, `customer`, `client`, `owner`) with key material
  (`secret`, `seed`, `keypair`, `private_key`, `signing_key`, `mnemonic`) — in
  TypeScript, Rust, JSON, YAML and TOML;
- a **literal Stellar secret seed** (`S` + 55 base32 characters).

Comments, prose and text inside string literals are not matched — only places a
value is stored. Writing "never store a user secret" in a doc comment does not
fail the build.

### It is advisory

The gate is **not** a required check, and it must not be added to the
required-checks set. A reviewer who has looked at a genuine false positive
applies the **`custody-reviewed`** label, and the gate passes. So a bad
heuristic can never wedge the repo, and clearing one always leaves a record of
who decided it was fine.

Run it locally before pushing:

```bash
node scripts/check-no-user-custody.mjs                    # everything covered
node scripts/check-no-user-custody.mjs --base origin/main # just your changes
```

The gate only catches the shape of the mistake that can be pattern-matched. The
rule is broader than the check, and review is where the rest of it is enforced.

---

## 3. Build order: W0 → W4, fixed

| Stage | What lands | Why here |
|---|---|---|
| **W0** | First-party time-based workers | The only tier where the operator is also the only trust assumption, so a mistake is contained to the operator |
| **W1** | The worker standard and `worker-core` | Interfaces cannot be designed before one real worker exists to design them against |
| **W2** | External operators, subscriptions, notifications | Adds parties, but still no authority — the record is billing and notification only |
| **W3** | Backstop, time-insensitive tier only | The first *promise* to a subscriber, restricted to the tier where lateness is a non-event |
| **W4** | Latency-sensitive tier | The expensive promise, last |

The order is set by **risk, not convenience.** W4 is the stage where a missed
firing is a real loss to a subscriber, so it lands only once the monitoring,
the SLOs and the operator diversity exist to keep the promise. The tier
abstraction is built in W3 with the latency-sensitive tier defined but disabled
behind an explicit flag (21.3), so the expensive promise cannot be made before
the infrastructure exists to keep it. That flag is a safety device, not a
feature toggle: it is not flipped for a demo.

---

## 4. The bootstrap position, stated honestly

Orbital runs its own workers first, for a bounded first-party tier.

That is a concentration of blast radius and it should be named as one. A single
operator means one outage is one incident affecting everybody it touches. Many
independent operators turn that same outage into many contained incidents, most
of which nobody notices, because someone else fires the trigger.

So the intent to diversify is real and it is a requirement of W2, not an
aspiration. Until it lands, the honest description of this layer is "one
operator, whose failure makes things late", and rule 3 is what keeps that
acceptable.

---

## 5. Frozen non-goals

These are frozen for the worker layer, not deferred. No issues, no partial
implementations, no "small version to start with":

- **No staking.**
- **No slashing.**
- **No bonding pools.**
- **No economic-security adjudication.**

All four are answers to the question "how do we punish a worker that misbehaves".
Under rule 1 a worker cannot misbehave in a way that moves money, so the
question does not arise — and building the machinery anyway would create the
custody relationship the rules exist to prevent, while making the layer look
like a staking product to anyone reading it from outside.

---

## 6. Two corrections that must not be re-litigated

### CAP-0066 obsoletes the TTL-keeper use case

"Workers that top up Soroban state TTLs before entries expire" was a plausible
first product. CAP-0066 removes the need for it at the protocol level. It is
recorded here so it is not proposed again as a fresh idea in six months.

### P23: workers are application-layer and cannot repair core ledger state

The tempting version of this claim — that a parallel worker network provides
redundancy against core protocol or ledger-level failure — is attractive to
funders and **false**. Workers sit above the ledger. They observe it and they
call contracts on it. They cannot repair it.

What parallel monitoring actually buys is earlier detection: a canary, not a
cure. Stating it plainly is part of why this document exists.

---

## Related documents

- [`docs/design/prior-art-workers.md`](./prior-art-workers.md) — competitive and
  prior-art notes, kept out of this document because they date fast and are
  self-reported rather than audited
- [`docs/design/vault-pattern.md`](./vault-pattern.md) — rule 2 in code: the
  constrained vault a worker calls into
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — system architecture
- [`ROADMAP.md`](../../ROADMAP.md) — phases and the freeze procedure
- [`packages/worker-core/README.md`](../../packages/worker-core/README.md) —
  the package these rules govern
