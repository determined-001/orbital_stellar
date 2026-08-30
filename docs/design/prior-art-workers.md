# Prior art: automation and keeper networks

Companion to [`workers.md`](./workers.md). These notes live here rather than in
the architecture document for one reason: **they date fast and they are
self-reported, not audited.** Uptime numbers, operator counts and security
claims below come from each project's own documentation. Nothing here has been
independently verified, and anything read from this file should be re-checked
before it is repeated anywhere a reader would take it as fact.

Kept because "why is Orbital's worker layer shaped this way rather than the
obvious way" is a question every new contributor and every reviewer asks, and
the answer is easier to give with the alternatives on the page.

---

## The two families

Automation networks divide cleanly on one question: **does the trigger hold
authority over the funds it moves?**

### Family A — the trigger holds authority

The automation service is granted an allowance, a delegated key, or a
privileged role, and uses it to act on the user's behalf. This is the majority
of the category, because it is much easier to build: the contract needs no
special design, and anything expressible as a transaction becomes automatable.

The cost is that the service is now a custodian in every way that matters. Its
key compromise is the user's loss. Its operator's decisions are the user's
exposure. The security model is "trust the operator, and the operator's
infrastructure, and the operator's key management".

Most of the machinery the category is known for — staking, bonding, slashing,
economic-security adjudication — exists to make that trust bearable. It is
answering a question this design does not ask.

### Family B — the trigger holds nothing

The contract is written so the privileged action is permissionless: it checks
its own conditions and does not care who called it. The automation service
becomes a party that pays gas to call a function anyone could have called.

This is strictly harder to build, because it constrains the contract, and it
cannot automate an arbitrary pre-existing contract. What it buys is that the
worst case is lateness rather than loss.

**Orbital's worker layer is Family B and only Family B.** That is
[rule 1](./workers.md#rule-1--a-worker-triggers-it-never-custodies), and it is
why the frozen non-goals list reads the way it does: the staking machinery is
Family A's answer to Family A's problem.

---

## What the comparison does *not* establish

- **Not that Family A is wrong.** It is a different product with a different
  risk posture, and for automating contracts you did not write it is the only
  thing that works.
- **Not that Family B is safer in operation.** A permissionless `disburse()`
  with a bad condition check is a bug like any other. The claim is narrower and
  worth stating exactly: *a compromised worker cannot redirect funds*, because
  it never had the authority to.
- **Not a market claim.** Whether anyone wants to buy triggering-without-custody
  is settled by the named counterparty in the unfreeze rationale (18.1), not by
  this document.

---

## Re-checking these notes

Anything in this file older than a release cycle should be treated as stale.
When updating:

1. Cite the project's own documentation, with the date read.
2. Keep self-reported figures labelled as self-reported.
3. Leave the conclusions in [`workers.md`](./workers.md) — this file records
   what others do, not what Orbital does.
