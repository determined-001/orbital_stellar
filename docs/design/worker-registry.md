# Worker Registry Data Model

> **Status:** Accepted · **Issue:** [#1055](https://github.com/determined-001/orbital_stellar/issues/1055) · **Milestone:** Phase 4 - Workers W2: external operators

## Summary

Extend the abi-registry data model with two new record kinds — `OperatorRecord` and `WorkerOfferingRecord` — to represent who offers worker services, which trigger types they handle, on what terms, and for which contracts.

Orbital is the registry, standard, and verification layer — **not** the guarantor of anyone's execution. The data model makes that explicit: no field asserts or implies an Orbital guarantee.

## Motivation

§C.4 of the worker spec requires a registry of who offers worker services. Rather than creating a second registry concept, we extend the existing abi-registry: one registry, two record kinds (spec records and worker records).

## Design

### OperatorRecord

Describes a worker operator: identity, contact info, supported trigger classes, networks, structured terms, and a self-declared latency tier.

```
OperatorRecord
├── id              (kebab-case slug, unique)
├── name            (human-readable)
├── stellarAddress  (G... for on-chain identity)
├── contact         (email or URL)
├── maintainer      (GitHub handle)
├── supportedTriggers (event | schedule | http | manual)
├── networks        (mainnet | testnet | futurenet)
├── terms           (structured: price, denomination, daily cap, SLA)
├── latencyTier     (realtime | low | standard | bulk)
├── version         (semver — a terms change produces a new version)
├── createdAt       (ISO 8601)
└── updatedAt       (ISO 8601)
```

### WorkerOfferingRecord

Describes a specific worker service offering: which contract/function it targets, what trigger class, what it costs, and which operator provides it.

```
WorkerOfferingRecord
├── id              (kebab-case slug, unique)
├── contractId      (C... target contract)
├── functionName    (target function)
├── triggerClass    (event | schedule | http | manual)
├── terms           (structured: price, denomination, daily cap, SLA)
├── operatorId      (references OperatorRecord.id)
├── version         (semver — a terms change produces a new version)
├── createdAt       (ISO 8601)
└── updatedAt       (ISO 8601)
```

### Structured Terms

Terms are structured data (`OperatorTerms`), not prose blobs:

```ts
OperatorTerms {
  pricePerInvocation: number   // price per invocation
  denomination: string         // "USD", "XLM", "USDC"
  dailyCap: number             // max invocations/day, 0 = unlimited
  slaMs: number                // SLA response time ms, 0 = no SLA
  notes?: string               // optional free-text (max 500 chars)
}
```

This makes terms comparable across operators: a subscriber can programmatically rank operators by price, SLA, or capacity.

### Versioning

Both record kinds use semver versioning. A terms change produces a new version rather than rewriting history. This matters for disputes: a subscriber signed up under the terms as they stood, and that version must remain resolvable.

### No Orbital Guarantee

No field in either record asserts or implies an Orbital guarantee of execution. Orbital verifies:
- Operator identity (Stellar account ownership)
- Contract existence (the target contract is deployed)

Orbital does **not** verify:
- Execution correctness
- Uptime or availability
- Accuracy of declared terms

## Files

| File | Purpose |
|---|---|
| `packages/abi-registry/src/types.ts` | TypeScript types and validation functions |
| `packages/abi-registry/schema/operator.schema.json` | JSON Schema for OperatorRecord |
| `packages/abi-registry/schema/worker-offering.schema.json` | JSON Schema for WorkerOfferingRecord |
| `docs/design/worker-registry.md` | This design doc |

## Reuse

- Records are validated using the same patterns as attestation documents and taxonomy entries.
- Schemas are published alongside existing registry schemas.
- Validation functions follow the `validate*` pattern (return result, never throw).
- Records can be cached using the existing `LruCache` and `TtlLruCache` from the abi-registry package.

## Licensing

This data is MIT-licensed open data, consistent with `docs/open-source-policy.md` and `data/LICENSE`.
