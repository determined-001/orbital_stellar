```text
SEP: 0000
Title: Orbital ABI Registry & Taxonomy Standard
Author: Orbital Contributors
Status: Draft
Created: 2026-07-27
Requires: SEP-48
```

## 1. Simple Summary
This proposal defines an off-chain schema registry with a verification pipeline, retroactive schema attestation for pre-SEP-48 contracts, a semantic taxonomy, and an entity-label format on top of raw Soroban event schemas.

## 2. Abstract
As the Soroban ecosystem matures, normalizing event data is critical. [SEP-48] standardizes event schemas embedded in a contract's Wasm. However, a gap remains for pre-SEP-48 contracts, off-chain registry verification, and higher-level semantic taxonomies. This SEP defines an open standard for registering, attesting, and semantically labeling event schemas without competing with SEP-48.

## 3. SEP-48 Compatibility Clause
An embedded SEP-48 event spec is the canonical schema source for any contract that includes it. The registry defined in this document adds attestation and semantic layers on top; it never provides a competing schema. If a SEP-48 schema exists, tools MUST prefer it over a standalone registry schema [Issue 7.1 gap memo].

## 4. Off-Chain Schema Registry and Verification
To prevent bloating on-chain state, full schema payloads are stored off-chain. The on-chain registry contract stores only a cryptographic hash and a pointer to the off-chain blob [Issue 7.2 prior-art survey].

### 4.1. Verification Pipeline
The off-chain registry MUST implement a verification pipeline cross-checking any submitted schema against the on-chain `contractspec`.
The pipeline guarantees that the registered schema structurally matches the compiled types emitted by the contract [Issue 7.1 gap memo].

## 5. Retroactive Schema Attestation
For pre-SEP-48 contracts already deployed on mainnet, their Wasm does not contain embedded event schemas.
The registry MUST support a retroactive schema attestation flow [Issue 7.3 attestation schema].
The deployer of the pre-SEP-48 contract signs the attestation over the schema payload [Issue 7.4 signature envelope].

## 6. Semantic Taxonomy and Entity-Label Format
Raw event topics (e.g., a hash or simple symbol) lack rich context. This SEP introduces a semantic taxonomy to standardize common lifecycle events across protocols [Issue 7.7 taxonomy schema].

### 6.1. Entity Labels
The standard defines an entity-label format allowing verified attribution (e.g., protocol, deployer, asset-issuer).
