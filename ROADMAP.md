# Roadmap

> Orbital is the typed event layer for Stellar — SDKs that turn raw Horizon
> operations and Soroban contract events into normalized, decoded, strongly-typed
> streams, plus the open registry and schema standard that makes that decoding
> canonical. This document describes the planned work in concrete terms. Dates
> are targets, not guarantees.
>
> **Legend.** `[x]` shipped on `main` today · `[-]` in flight · `[ ]` planned.
>
> **Ship discipline.** Each phase has a named **release gate** — a command
> and a condition that must both be green before the phase is considered
> shipped. A phase does not ship partial.

---

## What Orbital is (and is not)

Orbital is not a runtime, not a payments product, and not an identity layer.
It is a compounding loop:

1. A contract's event schema gets **registered** in the ABI registry.
2. `orbital codegen` **embeds** those registry types directly in downstream
   codebases, so the schema travels with the code that consumes it.
3. Real usage surfaces **community labels and taxonomy corrections** —
   `swap.executed` instead of a raw topic hash, a verified deployer attribution.
4. Richer semantics make the registry **canonical** — the place a contract's
   event shape is defined, not just one place it happens to be documented.
5. A **SEP-governed schema** becomes the format other tools emit against,
   closing the loop: registration is now worth doing because the standard it
   feeds is the one everyone reads.

Everything on this roadmap exists to serve that loop. Everything else —
payments, identity, agent infrastructure, intent compilers — is out of scope
and lives in the [Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven)
section below, not on the active roadmap.

---

## At a glance

| Phase | Theme | Tag | Target gate | Status |
|---|---|---|---|---|
| **Phase 0 — Foundation** | Typed SDKs for Stellar classic operations | `v0.1.0` | `pnpm -r typecheck && pnpm test` green; tag pushed; CHANGELOG entry shipped | 🟢 **Released 2026-05-29** |
| **Phase 1 — Production SDK** | Soroban + cursor persistence + stability pledge | `v1.0.0` | `pnpm publish -r --filter "./packages/*"` succeeds; STABILITY.md merged; Soroban e2e test green | 🟡 **In progress** — STABILITY.md merged (this PR); starter boilerplates + `v1.0.0` tag outstanding |
| **Phase 2 — The Decoding Standard** | SEP draft, `orbital codegen`, semantic layer, hosted registry | `v1.x` | SEP draft submitted; `orbital codegen` published and used in all three starter boilerplates; ≥25 contracts with registered verified schemas; hosted registry serving reads in production | ⚪ 2026 H2 |
| **Phase 3 — Anchor Events** | SEP-24/31 lifecycle events, `@orbital-stellar/anchor-sdk` | `v2.0.0` | `@orbital-stellar/anchor-sdk` on npm; SEP-24 + SEP-31 lifecycle events normalized into the standard taxonomy; ≥1 named anchor consuming it in production | ⚪ 2027 H1 |

The former "Trust & Agent Layer" and "Protocol Permanence" phases are not
gone — they are preserved verbatim in the
[Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven) section below.

---

## Phase 0 — Foundation (`v0.1.0`, shipped)

**Goal:** SDKs that any Stellar developer can install and use today.

**Release gate (met 2026-05-29):** `pnpm -r typecheck && pnpm test` green across all packages; `v0.1.0` tag pushed; [`CHANGELOG.md`](./CHANGELOG.md) entry written with Added / Changed / Fixed / Security / Impact sections.

### Wave 0.1 — Classic operation coverage

- [x] Horizon SSE subscription with AWS Full-Jitter reconnection
- [x] Full classic operation taxonomy normalized into `NormalizedEvent`: payments, account create/merge/options/bump-sequence, trustlines (change/allow/set_flags), DEX offers, claimable balances, liquidity pools, manage_data
- [x] Per-address `Watcher` pub/sub with `*` wildcard and per-watcher `filter` predicate
- [x] `engine.subscribe`, `engine.unsubscribe`, `engine.unsubscribeAll`, `engine.status`
- [x] Testnet + mainnet support; `horizonUrl` override for self-hosted nodes

### Wave 0.2 — Webhook delivery

- [x] HMAC-SHA256 signing with `x-orbital-signature`, `x-orbital-timestamp`, `x-orbital-attempt`
- [x] `verifyWebhook` (Node, timing-safe) and `verifyWebhookEdge` (Web Crypto)
- [x] Exponential-backoff retry with concurrent-retry cap (`webhook.dropped` on eviction)
- [x] Per-attempt `AbortController` timeout (default 10s)
- [x] SSRF hardening with DNS-rebinding defense

### Wave 0.3 — React hooks

- [x] `useStellarEvent<T>` with generic type narrowing
- [x] `useStellarPayment`, `useStellarActivity`
- [x] Dual call signature (positional + config object)
- [x] Stable dep-array via sorted `eventKey`

### Wave 0.4 — Lifecycle and operational hygiene

- [x] `engine.reconnecting`, `engine.reconnected`, `engine.rate_limited`, `engine.stopped` notifications
- [x] Rate-limit (`429`) handling with `Retry-After` parsing
- [x] Graceful `engine.stop()` on SIGTERM/SIGINT in the reference composition

### Wave 0.5 — Repo and project hygiene

- [x] CI matrix (Node 20, 22), CodeQL, Dependabot
- [x] All-contributors integration with bot wiring
- [x] [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/COOKBOOK.md`](./docs/COOKBOOK.md), [`docs/open-source-policy.md`](./docs/open-source-policy.md), [`docs/proposal.md`](./docs/proposal.md)
- [x] Public marketing + documentation site (`apps/web`) with sandboxed demo API routes
- [x] Reference composition consolidated into `apps/web` — one runtime to self-host

---

## Phase 1 — Production-grade SDK (`v1.0.0`, in progress)

**Goal:** a stability-pledged `v1.0` that teams can build production systems on.

**Release gate:** `pnpm publish -r --filter "./packages/*"` succeeds against npm with `version: "1.0.0"`; `STABILITY.md` merged with documented semver contract; Soroban subscription e2e test passing against testnet RPC; M1–M6 in [`docs/proposal.md`](./docs/proposal.md) all check out. Waves 1.1–1.3 below have shipped; Wave 1.5 is now down to boilerplates and the tag.

### Wave 1.1 — Soroban event subscription

- [x] Stellar RPC subscriber feeding the same normalization pipeline
- [x] `contract.invoked` and `contract.emitted` normalized event types
- [x] `engine.subscribeContract({ contractId, topics })` API
- [x] Topic filter and contract ID filter

### Wave 1.2 — ABI Registry (client machinery only)

This wave ships the **client** side of the registry — discovery, decoding, and
codegen primitives. The schema standard, hosted service, and semantic layer
that make the registry canonical move to Phase 2, where they belong alongside
the SEP draft.

- [x] `@orbital-stellar/abi-registry` client package
- [x] On-chain `contractspec` discovery (`discoverContract`, `fetchContractCode`, `parseContractSpec`, `xdrToSpec`)
- [x] `decodedData` field on `contract.emitted` for registered contracts
- [x] Type-generation primitives (`generate.ts`) — the foundation `orbital codegen` builds on in Wave 2.2

### Wave 1.3 — Cursor persistence and replay primitives

- [x] `CursorStore` interface on `EventEngine` config
- [x] Reference adapters — memory, file, Postgres, Redis, S3
- [x] `RetryQueue` interface on `WebhookDelivery`
- [x] Reference adapters — memory, Redis, SQS

### Wave 1.4 — Discriminated union refinement

- [ ] Narrow `NormalizedEvent` types so `switch (event.type)` produces exhaustive type narrowing with no `default` clause
- [ ] Generated schemas from Horizon's OpenAPI

### Wave 1.5 — Distribution

- [ ] Starter boilerplates: `orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`
- [x] `pnpm add @orbital-stellar/pulse-core` works against npm
- [x] `STABILITY.md` — semver contract, deprecation window (6 months), breaking-change policy
- [ ] `v1.0.0` git tag with full release notes

---

## Phase 2 — The Decoding Standard (`v1.x`, 2026 H2)

**Goal:** make the registry the canonical source of truth for what a Soroban contract's events mean — not just a convenience client.

**Release gate:** SEP draft submitted to `stellar/stellar-protocol`; `orbital codegen` published to npm and used in all three starter boilerplates; ≥25 contracts with registered verified schemas; hosted registry serving reads in production.

### Wave 2.1 — SEP draft

This is the **highest-leverage item on the roadmap.** Everything else in this
phase is either infrastructure for it or evidence that it works.

- [ ] Draft SEP for a standardized Soroban event schema and registry verification spec
- [ ] Reference-implementation checklist mapping every SEP clause to code in this repo
- [ ] Submit as a draft PR to `stellar/stellar-protocol`

### Wave 2.2 — `orbital codegen`

- [ ] CLI that takes a contract ID and emits TypeScript types, typed event guards, and `useContractEvent<T>` hooks from the registry schema — building on the existing `generate.ts` in `packages/abi-registry`
- [ ] `orbital.config.ts` contract manifest so regeneration is one CI command
- [ ] Watch mode
- [ ] Generated output committed in all three starter boilerplates

### Wave 2.3 — Semantic layer

- [ ] Human-readable event taxonomy on top of raw topics (e.g. `swap.executed`, `loan.liquidated`) with community-submitted mappings
- [ ] Entity labels — verified contract → protocol/deployer/asset-issuer attribution — with a public submission and review flow
- [ ] Labels and taxonomy published as **open data** (see [`docs/open-source-policy.md`](./docs/open-source-policy.md) — the data is open, the operated service is the product)

### Wave 2.4 — Hosted registry (operated)

- [ ] Hosted read API for schemas, taxonomy, and labels (client stays MIT)
- [ ] Verification pipeline cross-checking submitted schemas against on-chain `contractspec`
- [ ] Public registry explorer page in `apps/web`

---

## Phase 3 — Anchor Events (`v2.0.0`, 2027 H1)

**Goal:** extend the typed event taxonomy across the SEP-24 / SEP-31 anchor lifecycle, so compliance and audit tooling gets the same normalized-stream treatment as on-chain events.

**Release gate:** `@orbital-stellar/anchor-sdk` on npm; SEP-24 and SEP-31 lifecycle events normalized into the standard taxonomy; at least one named anchor consuming it in production.

- [ ] **`@orbital-stellar/anchor-sdk`** — typed client for SEP-24 interactive deposit/withdrawal and SEP-31 cross-border payment lifecycle events
- [ ] **Lifecycle taxonomy** — `anchor.deposit.*`, `anchor.withdrawal.*`, `anchor.payment.*` mapped to the SEP-defined status machines
- [ ] **Replay-safe delivery recipes** — cursor + retry queue composition documented in [`docs/COOKBOOK.md`](./docs/COOKBOOK.md) for audit-trail use cases
- [ ] **Design-partner program** — 2–3 anchors or Soroban protocol teams co-designing the surface before `v2.0.0` freezes

---

## Frozen — out of scope until the core thesis is proven

These items are **frozen, not deferred.** No issues, no waves, no partial
implementations accepted against any row below while Phases 1–3 are open.

| Frozen item | Why frozen |
|---|---|
| `@orbital-stellar/payments`, `@orbital-stellar/auth` (passkeys/WalletConnect), identity layer | Different product category; competes with wallet SDKs and SDF-funded smart-account work. "Identity in 80% of Stellar apps" was a vanity target, not a defensible moat. |
| `@orbital-stellar/x402`, `@orbital-stellar/agent-sdk` | SDF is shipping first-party x402 tooling. Revisit only if agent payments create demand for typed agent **event** streams — that's our actual lane, not the payment rail itself. |
| Intent compiler, shadow-fork simulator, reactor contracts | Each of these is a standalone company in its own right. None of them advances the registry loop. |
| `@orbital-stellar/analytics` dashboards | Belongs to the operated service per [`docs/open-source-policy.md`](./docs/open-source-policy.md), not the SDKs. |
| "10+ SEPs authored" | One accepted SEP that others implement beats ten drafts sitting in review. The target is one. |

Unfreezing any row requires the Phase 2 gate met **and** the Phase 3 gate met
**and** a maintainer-signed rationale recorded in [`CHANGELOG.md`](./CHANGELOG.md).

---

## What's not on this roadmap

- Support for non-Stellar networks
- Hosted / managed infrastructure beyond the registry read API (the hosted runtime is a separate product per [`docs/open-source-policy.md`](./docs/open-source-policy.md), not part of this open-source repository)
- Operational dashboards and admin UIs (these belong in deployment tooling, not the SDKs)

---

## Contributing to the roadmap

If you have a feature request or want to propose a change to the roadmap, open a [GitHub Discussion in the Ideas category](https://github.com/determined-001/orbital_stellar/discussions/categories/ideas). Roadmap items that attract significant community interest move up in priority.

Roadmap changes that **add scope** (new waves, new packages, new phase items) follow the normal PR flow. Roadmap changes that **remove or postpone shipped scope** require a maintainer sign-off and a note in [`CHANGELOG.md`](./CHANGELOG.md) under `### Changed`. Proposals targeting a [Frozen](#frozen--out-of-scope-until-the-core-thesis-is-proven) item will be closed with a pointer to this document.
