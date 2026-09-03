# Workers: the custody constraint

> Scope: this document currently covers **§C.2 rule 3 only** — the rule the
> custody gate enforces. It is the target of
> `.github/workflows/custody-gate.yml`'s failure message, so it exists as soon as
> the gate does rather than after it. Broader worker architecture belongs here
> too and should be merged in as it lands.

## <a id="c2-no-user-custody"></a>§C.2 rule 3 — a worker never holds a user's key

**A design that requires a worker to hold signing authority over a user's
account is a design bug, not a feature.**

A worker's power is limited to *"call a constrained function"*, never *"decide
where money goes"*. This is the whole justification for the worker tiers
existing as a product: if a worker holds the key, what is being sold is custody
wearing a different name, and it should be evaluated — and regulated — as
custody.

### Why it is a rule and not a preference

The failure is not gradual. A worker that holds a user's key can, at any moment
and without further consent:

- move funds anywhere, not just to the destinations the user had in mind;
- be compelled to do so by whoever compromises the worker;
- keep doing so after the user believes they have stopped it.

None of those are mitigated by careful code in the worker. They are properties
of holding the key. The only thing that removes them is not holding it.

### What to do instead

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

## How the rule is enforced

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
