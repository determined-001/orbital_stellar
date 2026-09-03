# Roadmap

> Orbital is the typed event layer for Stellar - SDKs that turn raw Horizon
> operations and Soroban contract events into normalized, decoded, strongly-typed
> streams, plus the open registry and schema standard that makes that decoding
> canonical. This document describes the planned work in concrete terms. Dates
> are targets, not guarantees.
>
> **Legend.** `[x]` shipped on `main` today · `[-]` in flight · `[ ]` planned.
>
> **Ship discipline.** Each phase has a named **release gate** - a command
> and a condition that must both be green before the phase is considered
> shipped. A phase does not ship partial.

---

## What Orbital is (and is not)

Orbital is not a runtime, not a payments product, and not an identity layer.
It is a compounding loop:

1. A contract's event schema gets **registered** in the ABI registry.
2. `orbital codegen` **embeds** those registry types directly in downstream
   codebases, so the schema travels with the code that consumes it.
3. Real usage surfaces **community labels and taxonomy corrections** -
   `swap.executed` instead of a raw topic hash, a verified deployer attribution.
4. Richer semantics make the registry **canonical** - the place a contract's
   event shape is defined, not just one place it happens to be documented.
5. A **SEP-governed registry and taxonomy standard** - building on
   [SEP-48](https://github.com/orgs/stellar/discussions/1724)'s embedded event
   schemas, not competing with them - becomes the format other tools emit
   against, closing the loop: registration is now worth doing because the
   standard it feeds is the one everyone reads.

Everything on this roadmap exists to serve that loop. Everything else -
payments, identity, agent infrastructure, intent compilers - is out of scope
and lives in the [Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven)
section below, not on the active roadmap.

---

## At a glance

| Phase | Theme | Tag | Target gate | Status |
|---|---|---|---|---|
| **Phase 0 - Foundation** | Typed SDKs for Stellar classic operations | `v0.1.0` | `pnpm -r typecheck && pnpm test` green; tag pushed; CHANGELOG entry shipped | 🟢 **Released 2026-05-29** |
| **Phase 1 - Production SDK** | Soroban + cursor persistence + stability pledge | `v1.0.0` | `pnpm publish -r --filter "./packages/*"` succeeds; STABILITY.md merged; Soroban e2e test green | 🟡 **In progress** - STABILITY.md merged (this PR); starter boilerplates + `v1.0.0` tag outstanding |
| **Phase 2 - The Decoding Standard** | SEP draft, `orbital codegen`, semantic layer, hosted registry | `v1.x` | SEP draft submitted; `orbital codegen` published and used in all three starter boilerplates; ≥25 contracts with registered verified schemas; hosted registry serving reads in production | ⚪ 2026 H2 |
| **Phase 3 - Anchor Events** | SEP-24/31 lifecycle events, `@orbital-stellar/anchor-sdk` | `v2.0.0` | `@orbital-stellar/anchor-sdk` on npm; SEP-24 + SEP-31 lifecycle events normalized into the standard taxonomy; ≥1 named anchor consuming it in production | ⚪ 2027 H1 |
| **Phase 4 - Workers entry gate** | Worker layer — trigger-without-custody standard + runtime | `v3.x` | W0–W4 each reach their gate; §C.2 no-custody constraint enforced on every stage; build order hard constraint (W4 lands last) | ⚪ 2026 H2 → 2027 |

The former "Trust & Agent Layer" and "Protocol Permanence" phases are not
gone - they are preserved verbatim in the
[Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven) section below.

---

## Phase 0 - Foundation (`v0.1.0`, shipped)

**Goal:** SDKs that any Stellar developer can install and use today.

**Release gate (met 2026-05-29):** `pnpm -r typecheck && pnpm test` green across all packages; `v0.1.0` tag pushed; [`CHANGELOG.md`](./CHANGELOG.md) entry written with Added / Changed / Fixed / Security / Impact sections.

### Wave 0.1 - Classic operation coverage

- [x] Horizon SSE subscription with AWS Full-Jitter reconnection
- [x] Full classic operation taxonomy normalized into `NormalizedEvent`: payments, account create/merge/options/bump-sequence, trustlines (change/allow/set_flags), DEX offers, claimable balances, liquidity pools, manage_data
- [x] Per-address `Watcher` pub/sub with `*` wildcard and per-watcher `filter` predicate
- [x] `engine.subscribe`, `engine.unsubscribe`, `engine.unsubscribeAll`, `engine.status`
- [x] Testnet + mainnet support; `horizonUrl` override for self-hosted nodes

### Wave 0.2 - Webhook delivery

- [x] HMAC-SHA256 signing with `x-orbital-signature`, `x-orbital-timestamp`, `x-orbital-attempt`
- [x] `verifyWebhook` (Node, timing-safe) and `verifyWebhookEdge` (Web Crypto)
- [x] Exponential-backoff retry with concurrent-retry cap (`webhook.dropped` on eviction)
- [x] Per-attempt `AbortController` timeout (default 10s)
- [x] SSRF hardening with DNS-rebinding defense

### Wave 0.3 - React hooks

- [x] `useStellarEvent<T>` with generic type narrowing
- [x] `useStellarPayment`, `useStellarActivity`
- [x] Dual call signature (positional + config object)
- [x] Stable dep-array via sorted `eventKey`

### Wave 0.4 - Lifecycle and operational hygiene

- [x] `engine.reconnecting`, `engine.reconnected`, `engine.rate_limited`, `engine.stopped` notifications
- [x] Rate-limit (`429`) handling with `Retry-After` parsing
- [x] Graceful `engine.stop()` on SIGTERM/SIGINT in the reference composition

### Wave 0.5 - Repo and project hygiene

- [x] CI matrix (Node 20, 22), CodeQL, Dependabot
- [x] All-contributors integration with bot wiring
- [x] [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/COOKBOOK.md`](./docs/COOKBOOK.md), [`docs/open-source-policy.md`](./docs/open-source-policy.md), [`docs/proposal.md`](./docs/proposal.md)
- [x] Public marketing + documentation site (`apps/web`) with sandboxed demo API routes
- [x] Reference composition consolidated into `apps/web` - one runtime to self-host

---

## Phase 1 - Production-grade SDK (`v1.0.0`, in progress)

**Goal:** a stability-pledged `v1.0` that teams can build production systems on.

**Release gate:** `pnpm publish -r --filter "./packages/*"` succeeds against npm with `version: "1.0.0"`; `STABILITY.md` merged with documented semver contract; Soroban subscription e2e test passing against testnet RPC; M1–M6 in [`docs/proposal.md`](./docs/proposal.md) all check out. Waves 1.1–1.3 below have shipped; Wave 1.4 is down to the OpenAPI-generated schemas; Wave 1.5 is down to boilerplates and the tag. Wave 1.6 does **not** gate `v1.0.0` - it is the first post-tag release (`v1.1.0`).

### Wave 1.1 - Soroban event subscription

- [x] Stellar RPC subscriber feeding the same normalization pipeline
- [x] `contract.invoked` and `contract.emitted` normalized event types
- [x] `engine.subscribeContract({ contractId, topics })` API
- [x] Topic filter and contract ID filter

### Wave 1.2 - ABI Registry (client machinery only)

This wave ships the **client** side of the registry - discovery, decoding, and
codegen primitives. The schema standard, hosted service, and semantic layer
that make the registry canonical move to Phase 2, where they belong alongside
the SEP draft.

- [x] `@orbital-stellar/abi-registry` client package
- [x] On-chain `contractspec` discovery (`discoverContract`, `fetchContractCode`, `parseContractSpec`, `xdrToSpec`)
- [x] `decodedData` field on `contract.emitted` for registered contracts
- [x] Type-generation primitives (`generate.ts`) - the foundation `orbital codegen` builds on in Wave 2.2

### Wave 1.3 - Cursor persistence and replay primitives

- [x] `CursorStore` interface on `EventEngine` config
- [x] Reference adapters - memory, file, Postgres, Redis, S3
- [x] Cache and write-coalescing `CursorStore` decorators (`cacheCursorStore`, `coalesceCursorStore`) - not separate backends, wrappers over any adapter above
- [x] `RetryQueue` interface on `WebhookDelivery`
- [x] Reference adapters - memory, Postgres, Redis, SQS

### Wave 1.4 - Discriminated union refinement

- [x] Narrow `NormalizedEvent` types so `switch (event.type)` produces exhaustive type narrowing with no `default` clause - enforced by `packages/pulse-core/test/types.exhaustive.test-d.ts`, run via `pnpm test:types`
- [ ] Generated schemas from Horizon's OpenAPI

### Wave 1.5 - Distribution

- [ ] Starter boilerplates: `orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`
- [x] `pnpm add @orbital-stellar/pulse-core` works against npm
- [x] `STABILITY.md` - semver contract, deprecation window (6 months), breaking-change policy
- [ ] `v1.0.0` git tag with full release notes

### Wave 1.6 - Unified event ingestion (CAP-67 / Protocol 23, ships as `v1.1.0`)

Protocol 23's [CAP-67](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md)
makes classic asset movements (transfer, mint, burn, clawback, fee,
set_authorized) emit Soroban-format events in a single unified stream, and SDF
has [deprecated Horizon in favor of Stellar RPC](https://developers.stellar.org/docs/data/apis/migrate-from-horizon-to-rpc).
Orbital's classic ingestion currently rides Horizon SSE - a legacy rail. This
wave moves asset-movement ingestion to the unified stream without changing the
`NormalizedEvent` surface consumers see.

- [ ] Ingest CAP-67 unified asset events from Stellar RPC, feeding the same
  normalization pipeline as Horizon and Soroban events today
- [ ] Map unified events onto the existing `NormalizedEvent` taxonomy -
  consumers see no behavior change; the transport underneath switches
- [ ] RPC-first for asset-movement events; Horizon SSE remains the source for
  operation types with no unified-event equivalent (offers, account options,
  claimable balances, manage_data) and the fallback transport otherwise -
  documented in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [ ] Cursor semantics compatible with `BACKFILL_STELLAR_ASSET_EVENTS`
  retroactive history, so replay from genesis-era ledgers is possible against
  a backfilled RPC/CDP source

**Release gate (`v1.1.0`):** unified-event ingestion e2e test green against a
Protocol 23 RPC; existing `NormalizedEvent` type tests (`pnpm test:types`)
unchanged and green.

---

## Phase 2 - The Decoding Standard (`v1.x`, 2026 H2)

**Goal:** make the registry the canonical source of truth for what a Soroban contract's events mean - not just a convenience client.

**Release gate:** SEP draft submitted to `stellar/stellar-protocol`; `orbital codegen` published to npm and used in all three starter boilerplates; ≥25 contracts with registered verified schemas; hosted registry serving reads in production.

### Wave 2.0 - Canonical registry infrastructure

The on-chain leg of the registry: a Soroban contract that makes schema
publication verifiable, plus the indexer that keeps it populated
automatically. This is what makes "canonical" true rather than aspirational.

- [ ] **On-chain registry contract** - code complete, blocked on deployment
  - [x] Soroban contract: `publish(contract_id, version, spec_hash, pointer)`, per-version
    lookup, publisher authorization, emits a `spec_published` event
    (`contracts/registry`, 7 unit tests)
  - [x] Stores hash + pointer (not the full spec) - integrity verifiable on-chain,
    spec blobs live off-chain
  - [ ] **Blocked on maintainer action:** deploy to testnet (needs a funded
    testnet account) and commit `contracts/deployed.testnet.json`
  - [ ] **Blocked on maintainer action:** wire `SOROBAN_CONTRACT_ID` +
    `SOROBAN_INVOKER_SECRET` repo secrets so the nightly integration test
    stops skipping
- [x] `OnChainRegistryPublisher` + `OnChainAbiRegistryClient` - on-chain
  publish and resolution path, wired into pulse-core's default registry
  chain (`@orbital-stellar/abi-registry`)
- [ ] Seed the registry with the 4 bundled well-known specs (USDC, EURC,
  AQUA, native XLM wrapper) through the live contract - script written and
  tested (`packages/abi-registry/scripts/seed-well-known.ts`), blocked on
  deployment
- [x] `AutoPublishIndexer` (`packages/orbital-indexer`) - unknown
  `contractId` auto-discovers, publishes under Orbital's key, and caches,
  with in-flight dedupe and backoff for undiscoverable contracts; manual
  `abi-registry publish` stays the override path
- [ ] **"Fire test event" button on `/demo/contracts`** - code complete,
  blocked on `demo-emitter` deployment (part of the deploy above)
- [x] Preload the playground with well-known mainnet contracts (USDC, EURC,
  AQUA) - verified live

### Wave 2.1 - SEP draft (building on SEP-48)

This is the **highest-leverage item on the roadmap.** Everything else in this
phase is either infrastructure for it or evidence that it works.

**Scope note.** [SEP-48](https://github.com/orgs/stellar/discussions/1724)
already standardizes event schemas *inside* the contract spec
(`#[contractevent]`; XDR merged, SDK and CLI support in flight). This SEP does
not compete with it - it standardizes what SEP-48 leaves open: contracts
deployed *before* SEP-48 existed, off-chain registry verification, and the
semantic layer above raw schemas.

- [x] Draft SEP covering (a) an off-chain schema registry with a verification
  pipeline cross-checking against on-chain `contractspec`, (b) **retroactive
  schema attestation** for pre-SEP-48 contracts already deployed on mainnet,
  and (c) a semantic taxonomy and entity-label format on top of raw event
  schemas
- [x] SEP-48 compatibility clause: an embedded SEP-48 event spec, when
  present, is the canonical schema source; the registry adds attestation and
  semantics on top, never a competing schema
- [x] Reference-implementation checklist mapping every SEP clause to code in this repo
- [ ] Submit as a draft PR to `stellar/stellar-protocol`

### Wave 2.2 - `orbital codegen`

- [x] `orbital typegen <contractId>` - ships TypeScript types + Zod schemas from
  a contract's resolved spec (registry first, WASM auto-discovery fallback);
  verified live against a mainnet contract
- [ ] Consume SEP-48 event specs natively - embedded `#[contractevent]` spec
  first, registry attestation as the fallback for pre-SEP-48 contracts.
  Differentiation vs `stellar contract bindings typescript` stays sharp:
  Zod runtime validation, typed event guards, and React hooks - not raw types
- [ ] Extend the CLI with typed event guards and `useContractEvent<T>` hooks
  from the registry schema - building on the existing `generate.ts` in
  `packages/abi-registry`
- [ ] `orbital.config.ts` contract manifest so regeneration is one CI command
- [ ] Watch mode
- [ ] Generated output committed in all three starter boilerplates

### Wave 2.3 - Semantic layer

- [ ] Human-readable event taxonomy on top of raw topics (e.g. `swap.executed`, `loan.liquidated`) with community-submitted mappings
- [ ] Entity labels - verified contract → protocol/deployer/asset-issuer attribution - with a public submission and review flow
- [x] Labels and taxonomy published as **open data** (see [`docs/open-source-policy.md`](./docs/open-source-policy.md) - the data is open, the operated service is the product)

### Wave 2.4 - Hosted registry (operated)

- [ ] Hosted read API for schemas, taxonomy, and labels (client stays MIT)
- [ ] Verification pipeline cross-checking submitted schemas against on-chain `contractspec`
- [ ] Public registry explorer page in `apps/web`
- [ ] Replay/history beyond RPC's ~7-day retention window - built **on top of
  the Composable Data Platform (Galexie exports) and CAP-67 retroactive
  backfill**, not as an Orbital-operated ledger store; second candidate move
  once this wave lands (semantics + memory = the full foundation); not yet
  scheduled to a wave

---

## Phase 3 - Anchor Events (`v2.0.0`, 2027 H1)

**Goal:** extend the typed event taxonomy across the SEP-24 / SEP-31 anchor lifecycle, so compliance and audit tooling gets the same normalized-stream treatment as on-chain events.

**Release gate:** `@orbital-stellar/anchor-sdk` on npm; SEP-24 and SEP-31 lifecycle events normalized into the standard taxonomy; at least one named anchor consuming it in production.

- [ ] **`@orbital-stellar/anchor-sdk`** - typed client for SEP-24 interactive deposit/withdrawal and SEP-31 cross-border payment lifecycle events
- [ ] **Lifecycle taxonomy** - `anchor.deposit.*`, `anchor.withdrawal.*`, `anchor.payment.*` mapped to the SEP-defined status machines
- [ ] **Replay-safe delivery recipes** - cursor + retry queue composition documented in [`docs/COOKBOOK.md`](./docs/COOKBOOK.md) for audit-trail use cases
- [ ] **Design-partner program** - 2–3 anchors or Soroban protocol teams co-designing the surface before `v2.0.0` freezes

---

## Phase 4 - Workers entry gate (`v3.x`, 2026 H2 → 2027)

**Goal:** open the worker layer — an open standard plus a runtime that lets
off-chain workers *trigger* on-chain settlement and other Orbital events
**without ever taking custody** of the funds they move. This phase was
unfrozen in writing by issue #1036 / the 2026-08-30
[`CHANGELOG.md`](./CHANGELOG.md) unfreeze entry, which is the maintainer-signed
rationale the [Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven)
procedure requires. The counterparty that motivated it is named in the
[`CHANGELOG.md`](./CHANGELOG.md) unfreeze entry (gate `W3`).

**Release gate (overall):** every one of the five stages `W0`–`W4` reaches its
individual gate below, the §C.2 trigger-≠-custodian constraint is enforced as a
review gate on every stage, and the build order is honored as a hard
constraint (W4 lands last — see below). No stage ships partial.

### The §C.2 constraint (quoted verbatim, not paraphrased)

> "The worker layer may trigger settlement but is never the custodian of the
> funds it moves. Triggering is not custody: a worker that signs a release
> instruction is exercising authority delegated by the vault contract, not
> holding the underlying asset. A design that lets a worker unilaterally custody
> user funds is out of scope and must be rejected at review."

This is quoted verbatim from `ORBITAL_PRD.md` §C.2 and is the immutable design
rule for the whole layer. It is cross-linked to
[`ORBITAL_PRD.md` §C.9](./ORBITAL_PRD.md#c9) — the gate definition — so the gate
survives even if the PRD doc itself goes stale. The gate's text is replicated
here on purpose rather than referenced only, because the PRD can drift.

### Build order is a hard constraint, not a suggestion

`W4` (backstop) **lands last**. No PR may merge `W4` work before `W0`–`W3` are
gated green. The backstop exists to *contain* a worker layer that is already
proven not to custody funds, so it cannot ship before the no-custody property
is demonstrated end-to-end. This ordering is enforced as a hard constraint in
the release process, not a scheduling preference.

### Staging W0–W4 (five stages, each with a gate)

- **`W0` — Worker standard (MIT).**
  *Gate:* the open standard (event-worker spec, trigger/attestation envelope)
  published and reviewed; reference types land in `packages/worker-core` as
  types only. No execution path, no funds path. This is the canonical surface
  other tools emit against.
- **`W1` — `worker-core` runtime (MIT).**
  *Gate:* `@orbital-stellar/worker-core` published to npm; trigger-execution
  e2e test green against testnet, **with a custody assertion test** that fails
  if the worker ever holds a signing key for user funds.
- **`W2` — vault contract (MIT).**
  *Gate:* `contracts/worker-vault` code complete, third-party audited, deployed
  to testnet; emits a release-event; unit tests green. The vault is the *only*
  contract with custodial authority — workers call into it, they never parallel
  it. This is what makes the §C.2 constraint true rather than aspirational.
- **`W3` — counterparty integration gate.**
  *Gate:* the named counterparty (see the [`CHANGELOG.md`](./CHANGELOG.md)
  unfreeze entry — name to be supplied by maintainer) signs off that the
  worker layer's trigger-without-custody primitive satisfies their
  settlement-desk automation need; at least one production settlement flow runs
  worker-triggered and vault-custodied. This gate is what motivated the
  unfreeze — see the [`CHANGELOG.md`](./CHANGELOG.md) unfreeze entry. Until
  `W3` is met, the worker layer stays staging-only.
- **`W4` — backstop (operated service, lands last).**
  *Gate:* Orbital-operated backstop in staging with a met SLO (time-to-contain
  on a worker fault) and a documented incident runbook. Ships only after
  `W0`–`W3` are green, per the hard build-order constraint above.

Workers are **not** implicitly frozen by the blanket scope rule below — they
are explicitly carved out here. Everything else in the Frozen section stays
frozen.

---

## Frozen - out of scope until the core thesis is proven

These items are **frozen, not deferred.** No issues, no waves, no partial
implementations accepted against any row below while Phases 1–3 are open.

**Carve-out (explicit, in writing):** the **worker layer (Part C)** is **not**
implicitly frozen by this blanket rule. It was unfrozen by issue #1036 / the
dated 2026-08-30 [`CHANGELOG.md`](./CHANGELOG.md) entry and now lives in
[Phase 4 — Workers entry gate](#phase-4--workers-entry-gate) above, not here.
Workers are removed from the implicit freeze; the rows below remain frozen.

| Frozen item | Why frozen |
|---|---|
| `@orbital-stellar/payments`, `@orbital-stellar/auth` (passkeys/WalletConnect), identity layer | Different product category; competes with wallet SDKs and SDF-funded smart-account work. "Identity in 80% of Stellar apps" was a vanity target, not a defensible moat. |
| `@orbital-stellar/x402`, `@orbital-stellar/agent-sdk` | SDF is shipping first-party x402 tooling. Revisit only if agent payments create demand for typed agent **event** streams - that's our actual lane, not the payment rail itself. |
| Intent compiler, shadow-fork simulator, reactor contracts | Each of these is a standalone company in its own right. None of them advances the registry loop. |
| `@orbital-stellar/analytics` dashboards | Belongs to the operated service per [`docs/open-source-policy.md`](./docs/open-source-policy.md), not the SDKs. |
| "10+ SEPs authored" | One accepted SEP that others implement beats ten drafts sitting in review. The target is one. |

Unfreezing any row requires the Phase 2 gate met **and** the Phase 3 gate met
**and** a maintainer-signed rationale recorded in [`CHANGELOG.md`](./CHANGELOG.md).

The worker-layer carve-out above is the maintainer-signed rationale required by
this procedure, recorded in the dated 2026-08-30 `CHANGELOG.md` unfreeze entry.
Workers were never an enumerated frozen row — they were only caught by the
blanket scope rule — so the unfreeze is the explicit, written lift of that
implicit freeze, tracked in [Phase 4](#phase-4--workers-entry-gate), not a new
procedure.

---

## What's not on this roadmap

- Support for non-Stellar networks
- Hosted / managed infrastructure beyond the registry read API (the hosted runtime is a separate product per [`docs/open-source-policy.md`](./docs/open-source-policy.md), not part of this open-source repository)
- Operational dashboards and admin UIs (these belong in deployment tooling, not the SDKs)

---

## Contributing to the roadmap

If you have a feature request or want to propose a change to the roadmap, open a [GitHub Discussion in the Ideas category](https://github.com/determined-001/orbital_stellar/discussions/categories/ideas). Roadmap items that attract significant community interest move up in priority.

Roadmap changes that **add scope** (new waves, new packages, new phase items) follow the normal PR flow. Roadmap changes that **remove or postpone shipped scope** require a maintainer sign-off and a note in [`CHANGELOG.md`](./CHANGELOG.md) under `### Changed`. Proposals targeting a [Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven) item will be closed with a pointer to this document.
