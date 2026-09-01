# Submitting an operator or worker offering

This is a how-to for getting an external operator into the
[worker registry](../design/worker-registry.md). It mirrors the
[semantic-layer submission flow](../semantic-layer/submitting.md) so
contributors meet one submission idiom across the project: submission,
automated validation, human review, publication.

For the general PR workflow (forking, branch naming, running checks
locally, the Stellar Wave Program), see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). This document only covers what's
specific to worker data: the two record shapes, where files live, what the
automated review checks look for, and the human review rubric.

---

## Which one do I want?

- **Operator record** — you're registering *who you are* as a worker
  operator: identity, contact, supported trigger classes, networks, and
  structured terms. Schema:
  [`packages/abi-registry/schema/operator.schema.json`](../../packages/abi-registry/schema/operator.schema.json).
- **Worker offering record** — you're registering *what you offer*: a
  specific contract/function you invoke, the trigger class, and the terms.
  Schema:
  [`packages/abi-registry/schema/worker-offering.schema.json`](../../packages/abi-registry/schema/worker-offering.schema.json).

A submission needs an operator record; an offering record is optional but
recommended (an operator with no offering has nothing to subscribe to).

---

## Submitting an operator record

1. Read the schema's `$defs` descriptions — they're normative, not just
   guidance.
2. Pick a unique kebab-case `id` (e.g. `acme-settlement`).
3. Set `stellarAddress` to the `G...` Stellar account you control. **This is
   the identity the registry verifies** — see the key-ownership proof below.
4. Fill in `terms` as structured data (price, denomination, daily cap, SLA),
   not prose.
5. Add the record as a new JSON file conforming to `operator.schema.json`.
   Real production records live under `data/operators/`; illustrative
   examples for docs live under
   [`packages/abi-registry/schema/examples/operators/`](../../packages/abi-registry/schema/examples/operators/).

### Worked example: an operator record

```json
{
  "id": "acme-settlement",
  "name": "Acme Settlement",
  "stellarAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "contact": "ops@acme.example",
  "maintainer": "@acme-ops",
  "supportedTriggers": ["event", "http"],
  "networks": ["mainnet"],
  "terms": {
    "pricePerInvocation": 0.01,
    "denomination": "USD",
    "dailyCap": 10000,
    "slaMs": 500,
    "notes": "Settlement finality within 500ms."
  },
  "latencyTier": "low",
  "version": "1.0.0",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z"
}
```

---

## Submitting a worker offering record

1. Confirm the target `contractId` is a `C...` address already registered in
   the registry — the automated gate rejects offerings whose target contract
   does not resolve.
2. Set `operatorId` to the `id` of your operator record.
3. Fill in `terms` as structured data.
4. Add the record as a new JSON file conforming to
   `worker-offering.schema.json`.

### Worked example: an offering record

```json
{
  "id": "acme-settlement-sweep",
  "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  "functionName": "sweep",
  "triggerClass": "event",
  "terms": {
    "pricePerInvocation": 0.01,
    "denomination": "USD",
    "dailyCap": 10000,
    "slaMs": 500
  },
  "operatorId": "acme-settlement",
  "version": "1.0.0",
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z"
}
```

---

## Key-ownership proof (required)

The one check that must **not** be skipped: without it, anyone can register
an offering under someone else's identity and harvest their reputation.

Alongside `operator.json` you must submit a `proof.json` that proves you
control the `stellarAddress` you claim. It contains:

```json
{
  "stellarAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "message": "<sha256 hex of the canonical operator record>",
  "signature": "<hex-encoded Ed25519 signature over the message>"
}
```

The `message` is the SHA-256 digest of the exact `operator.json` you are
submitting. Sign it with the private key of your `stellarAddress` (e.g. with
`@stellar/stellar-sdk`'s `Keypair.sign`). The automated gate verifies the
signature against the public key derived from your claimed address and fails
closed if it cannot verify.

---

## What automated review checks apply

The `Validate operator submission` script
(`scripts/validate-operator-submission.mjs`) runs on every pull request
touching `data/operators/**` and gates merge on:

- **Schema validation** — the operator and offering records must validate
  against their JSON Schemas (reusing `validateOperatorRecord` /
  `validateWorkerOfferingRecord` from `@orbital-stellar/abi-registry`, the
  same automation as the semantic-layer flow).
- **Key-ownership proof** — `proof.json` must be present, the message must
  match the sha256 of the operator record, and the signature must verify
  against the claimed `stellarAddress`. This check is never skipped.
- **Operator/offering linkage** — an offering's `operatorId` must match the
  operator record's `id`.
- **Contract resolution** — every target `contractId` must resolve in the
  registry (present in the well-known specs index or the labels index).

Rejections carry a machine-readable reason for each failed check so the
submitter can act on it.

---

## Human review rubric

Beyond the automated gate, a maintainer reviews the submission per the
[Stellar Wave Program flow](../../CONTRIBUTING.md#stellar-wave-program).
The review checks that a submission is **well-formed** and that the operator
**controls the key they claim**. It is explicitly **not** an endorsement of
their reliability — that is what W1's scores are for.

The published rubric:

1. **Well-formedness** — the records are schema-valid, the terms are
   structured and honest, and the offering targets a registered contract.
2. **Key ownership** — the signature in `proof.json` verifies against the
   claimed `stellarAddress`, and the address is not a shared or custodial
   account.
3. **No conflict of interest** — the `maintainer` handle does not appear
   inside the `name` or `contact` in a way that misrepresents identity.
4. **Copy is not an endorsement** — the submission's own copy must not claim
   Orbital guarantees execution quality, uptime, or correctness.

A submission that passes the automated gate but fails the human rubric is
rejected with a reason the submitter can act on.

---

## Publication

Once a submission passes automated validation and human review, it is merged
and published as open data under `data/operators/`. The published copy states
plainly that **listing in the registry is not an endorsement of reliability**:
Orbital verifies identity and contract existence, not execution quality,
uptime, or the accuracy of declared terms.

---

## Related reading

- [`../design/worker-registry.md`](../design/worker-registry.md) — the data
  model for operator and offering records.
- [`../semantic-layer/submitting.md`](../semantic-layer/submitting.md) — the
  semantic-layer submission flow this mirrors.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — the general PR workflow.
- [`.github/ISSUE_TEMPLATE/operator-submission.yml`](../../.github/ISSUE_TEMPLATE/operator-submission.yml)
  — the issue template for signaling intent before you submit.
