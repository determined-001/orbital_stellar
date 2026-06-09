# Roadmap

> Orbital's open-source packages are on a multi-year trajectory from Stellar
> event SDKs to a complete programmable runtime — hooks, payments, identity,
> agent payments, and the standards behind them. This document describes the
> planned work in concrete terms. Dates are targets, not guarantees.
>
> **Legend.** `[x]` shipped on `main` today · `[-]` in flight · `[ ]` planned.
>
> **Ship discipline.** Each phase has a named **release gate** — a command
> and a condition that must both be green before the phase is considered
> shipped. A phase does not ship partial.

---

## At a glance

| Phase | Theme | Tag | Target gate | Status |
|---|---|---|---|---|
| **Phase 0 — Foundation** | Typed SDKs for Stellar classic operations | `v0.1.0` | `pnpm -r typecheck && pnpm test` green; tag pushed; CHANGELOG entry shipped | 🟢 **Released 2026-05-29** |
| **Phase 1 — Production SDK** | Soroban + cursor persistence + stability pledge | `v1.0.0` | `pnpm publish -r --filter "./packages/*"` succeeds; STABILITY.md merged; Soroban e2e test green | ⚪ Q2–Q3 2026 |
| **Phase 2 — SDK Ecosystem** | `@orbital/hooks`, `@orbital/payments`, `@orbital/auth`, first SEP | `v2.0.0` | First SEP submission accepted or under review by SDF; `useBalance` + `useTransaction` on npm | ⚪ 2027 |
| **Phase 3 — Trust & Agent Layer** | x402, agent-sdk, intent compiler, shadow-fork | `v3.0.0` | x402 reference deployed; intent compiler OSS; ≥1,000 agent integrations | ⚪ 2028+ |
| **Phase 4 — Protocol Permanence** | Identity layer, reactor library, 10+ SEPs | n/a | 10 SEPs authored or co-authored; Orbital identity in `@orbital/auth` ≥80% of major Stellar apps | ⚪ long-term |

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

## Phase 1 — Production-grade SDK (`v1.0.0`, Q2–Q3 2026)

**Goal:** a stability-pledged `v1.0` that teams can build production systems on.

**Release gate:** `pnpm publish -r --filter "./packages/*"` succeeds against npm with `version: "1.0.0"`; [`STABILITY.md`](./STABILITY.md) merged with documented semver contract; Soroban subscription e2e test passing against testnet RPC; M1–M6 in [`docs/proposal.md`](./docs/proposal.md) all check out.

### Wave 1.1 — Soroban event subscription

- [ ] Stellar RPC subscriber feeding the same normalization pipeline
- [ ] `contract.invoked` and `contract.emitted` normalized event types
- [ ] `engine.subscribeContract({ contractId, topics })` API
- [ ] Topic filter and contract ID filter

### Wave 1.2 — ABI Registry

- [ ] `@orbital/abi-registry` client package (TBD final naming)
- [ ] Schema spec published as a draft SEP
- [ ] Hosted registry service (operated; client is MIT — see [`docs/open-source-policy.md`](./docs/open-source-policy.md))
- [ ] `decodedData` field on `contract.emitted` for registered contracts

### Wave 1.3 — Cursor persistence and replay primitives

- [ ] `CursorStore` interface on `EventEngine` config
- [ ] In-memory and on-disk reference adapters
- [ ] `RetryQueue` interface on `WebhookDelivery`
- [ ] In-memory reference adapter for retry queue

### Wave 1.4 — Discriminated union refinement

- [ ] Narrow `NormalizedEvent` types so `switch (event.type)` produces exhaustive type narrowing with no `default` clause
- [ ] Generated schemas from Horizon's OpenAPI

### Wave 1.5 — Distribution

- [ ] Starter boilerplates: `orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`
- [ ] `pnpm add @orbital/pulse-core` works against npm
- [ ] [`STABILITY.md`](./STABILITY.md) — semver contract, deprecation window (6 months), breaking-change policy
- [ ] `v1.0.0` git tag with full release notes

---

## Phase 2 — SDK Ecosystem (`v2.x`, 2027)

**Goal:** own the full Stellar developer SDK surface with a coherent, composable package family.

**Release gate:** first SEP submission accepted or under review by SDF; at least three data hooks (`useBalance`, `useTransaction`, `useAccount`) shipped to npm under `@orbital/hooks`; reference reactor contract published.

- [ ] **`@orbital/hooks`** — complete data-hook library: `useAccount`, `useBalance`, `useTransaction`, `useOrderBook`, full account activity surface
- [ ] **`@orbital/payments`** — transaction primitives: send, receive, path payment, payroll batch, with typed results
- [ ] **`@orbital/auth`** — embedded wallets via WebAuthn/passkeys, fee sponsorship, WalletConnect
- [ ] **`@orbital/analytics`** — client library and event-volume reference dashboards
- [ ] **Reactor contracts** — reference SDK and library of Soroban Rust contracts that react to events from other contracts
- [ ] **First SEP submission** — formalize the event normalization format so other implementations can interoperate

---

## Phase 3 — Trust & Agent Layer (`v3.x`, 2028+)

**Goal:** turn event subscriptions into programmable intent pipelines and capture the AI-agent economy on Stellar.

**Release gate:** `@orbital/x402` middleware deployed in a public reference application; intent compiler OSS published; ≥1,000 agent integrations recorded against `@orbital/agent-sdk`.

- [ ] **`@orbital/x402`** — Express/Next.js middleware for payment-gated API access via the HTTP 402 / x402 protocol
- [ ] **`@orbital/agent-sdk`** — payment client for autonomous AI agents; integrates with x402 for agent-to-agent and agent-to-service payments on Stellar
- [ ] **`@orbital/anchor-sdk`** — client library for SEP-24 and SEP-31 lifecycle events
- [ ] **Intent compiler** — declare "when X happens, do Y" as a typed intent; the compiler produces a webhook + reactor contract + replay policy
- [ ] **Shadow-Fork simulator (OSS core)** — fork any ledger state, inject hypothetical operations, replay Soroban invocations
- [ ] **Additional SEPs** — reactor contract spec, intent schema, attestation format

---

## Phase 4 — Protocol Permanence (long-term)

**Goal:** become the protocol layer on Stellar that other implementations follow.

**Release gate:** ten SEPs authored or co-authored across identity, events, reactors, x402, compliance reporting, attestation formats; Orbital identity layer adopted as the standard sign-in primitive in ≥80% of major Stellar applications.

- [ ] **Identity layer** — reference implementation for passkey-based embedded wallets and federated Stellar addresses
- [ ] **Reactor-contract library** — community-contributed library of hundreds of composable reactor patterns, maintained as an OSS standard
- [ ] **10+ SEPs** — spanning identity, events, reactors, x402, compliance reporting, attestation formats

---

## What's not on this roadmap

- Support for non-Stellar networks
- Hosted / managed infrastructure (the hosted runtime is a separate product per [`docs/open-source-policy.md`](./docs/open-source-policy.md), not part of this open-source repository)
- Operational dashboards and admin UIs (these belong in deployment tooling, not the SDKs)

---

## Contributing to the roadmap

If you have a feature request or want to propose a change to the roadmap, open a [GitHub Discussion in the Ideas category](https://github.com/determined-001/orbital_stellar/discussions/categories/ideas). Roadmap items that attract significant community interest move up in priority.

Roadmap changes that **add scope** (new waves, new packages, new phase items) follow the normal PR flow. Roadmap changes that **remove or postpone shipped scope** require a maintainer sign-off and a note in [`CHANGELOG.md`](./CHANGELOG.md) under `### Changed`.
