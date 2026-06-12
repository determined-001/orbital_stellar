# Orbital — Stellar's Real-Time Event SDK

**Proposal Track:** SCF Infrastructure Grant (Build Award)
**Status:** Phase 0 shipped (`v0.1.0`) · Requesting funding for Phase 1 (`v1.0`)
**Repository:** https://github.com/determined-001/orbital_stellar
**License:** MIT
**Last updated:** 2026-05-29

---

## Table of contents

1. [Summary](#summary)
2. [Problem](#problem)
3. [Solution](#solution)
4. [Track record — Phase 0 (shipped)](#track-record--phase-0-shipped)
5. [Phase 1 — Production-grade `v1.0`](#phase-1--production-grade-v10-the-scf-funded-milestone)
6. [Why Stellar needs this funded now](#why-stellar-needs-this-funded-now)
7. [Risks and mitigations](#risks-and-mitigations)
8. [Budget](#budget)
9. [Sustainability after Phase 1](#sustainability-after-phase-1)
10. [Team](#team)
11. [Roadmap context (out of scope)](#roadmap-context-out-of-scope-for-this-grant)
12. [Asks of the SCF reviewer](#asks-of-the-scf-reviewer)
13. [References](#references)

---

## Summary

Orbital is the open-source SDK layer Stellar developers reach for when they need real-time event subscriptions, signed webhook delivery, and React integration — the primitives every team currently re-implements from scratch on top of Horizon SSE and Stellar RPC.

Three MIT-licensed packages, designed to be composed and (at Phase 1) published to npm with no vendor lock-in:

| Package | Role |
|---|---|
| `@orbital-stellar/pulse-core` | Event engine — Horizon + Stellar RPC subscription, normalized typed events, reconnection |
| `@orbital-stellar/pulse-webhooks` | HMAC-signed webhook delivery, retry, SSRF hardening, edge-runtime verification |
| `@orbital-stellar/pulse-notify` | React hooks (`useStellarEvent`, `useStellarPayment`, `useStellarActivity`) |

Phase 0 (foundation) shipped as [`v0.1.0`](../CHANGELOG.md) — full classic operation taxonomy, edge-runtime verification, React hooks, reference composition. This proposal funds **Phase 1: production-grade `v1.0`** — the milestone at which any Stellar team can build on Orbital with a stability pledge.

---

## Problem

Stellar's official APIs give developers the raw firehose:

- **Horizon SSE** drops the connection on idle, requires backoff, has no replay, and exposes raw operations rather than application-shaped events.
- **Stellar RPC** keeps only ~7 days of Soroban event history and has no native subscription model.
- **Webhooks** are not part of the platform — every project rebuilds HMAC signing, retry, SSRF guards, and edge-runtime verification from scratch.
- **React integration** does not exist — every dashboard rebuilds SSE plumbing and lifecycle management.

The cost: every Stellar team — anchors, payment apps, DEX frontends, wallet teams — spends weeks building infrastructure that should be a `pnpm add`. There is no shared, auditable, maintained primitive.

**The competitive landscape, accurately:** QuickNode shipped basic Stellar webhook support in Q1 2026 — generic multi-chain DX without a native Stellar mental model, no React SDK, no SSE streaming interface, no edge-runtime verifier. Moralis offers early-access Stellar streams as part of its multi-chain warehouse, not as a low-latency event-delivery service. Sorobanhooks ships Soroban-only webhooks with no classic-operation coverage and no SDK layer. The gap Orbital fills is not "events on Stellar" — it is **a Stellar-native, MIT-licensed SDK family that covers the full operation taxonomy with edge-runtime verification and first-class React hooks in one coherent surface.**

---

## Solution

Orbital ships the primitives once, openly, with a multi-year commitment to keep the SDK surface stable and grow it in lockstep with the network (Soroban events, x402, future SEPs).

### Architecture

The system is three planes sharing one vocabulary — the **normalized event**: a subscription plane (`pulse-core`) that connects to Stellar and routes typed events to per-address `Watcher` subscribers; a delivery plane (`pulse-webhooks`) that signs and POSTs events with retry, timeout, and SSRF safety; and a consumption plane (`pulse-notify`) that opens an `EventSource` from a browser and re-renders React components on each event. Each plane is independently installable and independently composable. The reference composition that powers the on-page demo at the marketing site lives in a single Next.js route handler — about 50 lines of glue.

Full system diagrams, lifecycle sequence, and trust-boundary analysis live in [**`docs/ARCHITECTURE.md`**](./ARCHITECTURE.md).

### Why open-source

The SDKs are MIT — free for commercial and open-source use. Stellar developers should not pay a per-call fee to consume their own ledger's events. Orbital follows the **Vercel/Clerk model**: the SDK family is open and free; a separately-built closed Cloud product (out of scope for this grant) handles the multi-region orchestration and persistence that teams who do not want to run their own infrastructure pay for. **No feature in this proposal is contingent on the Cloud product, and no SDK capability is gated behind it.**

This is deliberately not the Supabase/MongoDB model — Orbital does not open-source the server, because doing so creates asymmetric infrastructure cost exposure and historically destroys the grant-funded project's ability to keep maintaining the OSS at scale.

---

## Track record — Phase 0 (shipped)

Phase 0 is complete and released as [`v0.1.0`](../CHANGELOG.md). Independently verifiable on the public repository:

| Deliverable | Status |
|---|---|
| Classic operation event streaming via Horizon SSE | ✅ Shipped |
| Full classic operation taxonomy: payments, account create/merge/bump-sequence, trustlines (change/allow/set_flags), DEX offer lifecycle, claimable balance lifecycle, liquidity pool deposit/withdraw, manage_data | ✅ Shipped |
| HMAC-signed webhook delivery with retry, exponential backoff, concurrent-retry caps | ✅ Shipped |
| Edge-runtime webhook verification (Cloudflare Workers, Vercel Edge) using Web Crypto API | ✅ Shipped |
| React hooks (`useStellarEvent`, `useStellarPayment`, `useStellarActivity`) | ✅ Shipped |
| SSRF hardening (private IP range blocks, DNS-rebinding defense) | ✅ Shipped |
| Reconnection with AWS Full Jitter backoff and rate-limit handling (`engine.rate_limited` on HTTP 429) | ✅ Shipped |
| Custom Horizon URL support (self-hosted node / regional mirror / futurenet) | ✅ Shipped |
| Reference composition consolidated into a single Next.js route handler — one runtime to self-host, not two | ✅ Shipped |
| Public marketing + documentation site (`apps/web`) with sandboxed demo API routes | ✅ Shipped |
| Testnet + mainnet support | ✅ Shipped |
| CI matrix (Node 20, 22), CodeQL static analysis, Dependabot, conventional commits, PR template | ✅ Shipped |

**Evidence trail:**

- [`CHANGELOG.md`](../CHANGELOG.md) — full `v0.1.0` release notes with Added / Changed / Fixed / Security / Impact sections.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — system diagrams, component inventory, lifecycle sequence, trust boundaries.
- [`PROGRESS.md`](../PROGRESS.md) — Phase 0 completion snapshot.
- [`ROADMAP.md`](../ROADMAP.md) — multi-year phase plan.
- Per-package READMEs: [`pulse-core`](../packages/pulse-core/README.md), [`pulse-webhooks`](../packages/pulse-webhooks/README.md), [`pulse-notify`](../packages/pulse-notify/README.md).
- Test suites: **103 tests** in `pulse-core` (102 passing + 1 skipped), **13 tests** in `pulse-webhooks`, all green in CI.

---

## Phase 1 — Production-grade `v1.0` (the SCF-funded milestone)

Phase 1 brings Orbital from "useful prototype" to a **stability-pledged `v1.0`** that teams can build production systems on. Six concrete deliverables, each with a clear merge criterion.

### M1 · Soroban event subscription

Subscribe to smart contract events by contract ID and topic filter via Stellar RPC. Normalized into the same `NormalizedEvent` taxonomy as classic operations.

**Done when:** A test subscribing to a deployed Soroban contract on testnet receives a typed event payload within 2 ledgers of emission.

### M2 · ABI Registry client

Auto-decode Soroban event payloads into typed, human-readable JSON using a community-contributed ABI registry. Solves the "raw bytes" problem that makes Soroban events painful to consume today.

**Done when:** A registered contract's events are fully typed in the consumer's TypeScript autocomplete without manual decoding.

### M3 · Discriminated union refinement

Narrow `NormalizedEvent` types so `switch (event.type)` produces exhaustive type narrowing in TypeScript strict mode.

**Done when:** A `switch` over `event.type` with no `default` clause produces a TypeScript error if any event type is unhandled.

### M4 · Cursor persistence and replay primitives

Pluggable durable adapters (Redis, Postgres, S3) so consumers can implement crash-resilient streams and webhook replay.

**Done when:** Killing the worker process mid-stream and restarting it does not lose or duplicate events when configured with a Postgres cursor adapter.

### M5 · Starter boilerplates

Three reference projects: `orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`. Demonstrate the SDK in production-shaped repos a Stellar team can fork in 5 minutes.

**Done when:** Each starter is published, deploys to Vercel/Railway free tier, and is documented end-to-end on the marketing site.

### M6 · `v1.0` stability pledge + npm publish

All three packages published under `@orbital-stellar/` on npm with a documented stability contract: no breaking changes within `v1.x` without a 6-month deprecation window.

**Done when:** `pnpm add @orbital-stellar/pulse-core` works, semver policy is documented in `STABILITY.md`, and a v1.0 release is tagged on GitHub.

---

## Why Stellar needs this funded now

**Soroban window:** Stellar RPC keeps ~7 days of event history. Every project that wants Soroban analytics, indexing, or webhooks needs an event consumer running continuously. Funding the SDK now means every project that ships during Soroban's growth phase reaches for the same primitive — increasing ecosystem interoperability and reducing duplicated infrastructure cost across the network.

**Standards leverage:** Phase 1 lays the groundwork for Phase 2's first SEP submission — formalizing the event normalization format so other implementations (Rust, Go, Python clients) can interoperate with Orbital-shaped events. SCF funding the reference TypeScript implementation makes the future SEP carry weight.

**Competitive timing:** QuickNode added basic Stellar webhooks in Q1 2026 — a generic multi-chain product. The window to establish a Stellar-native, edge-runtime, React-first SDK as the developer default is the next 12 months, before generic multi-chain DX hardens around Stellar. No Stellar-native alternative covers the three primitives (typed normalization + edge verification + React) in one coherent SDK family. Orbital does, today, in `v0.1.0`.

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Solo-maintainer bus factor** | High | High | The grant funds a contributor ladder. Phase 0 already shipped the Stellar Wave Program issue plumbing (150 pre-planned issues with complexity-tier rewards) and a contributors-table workflow. Target: ≥3 sustained external contributors with merged PRs by Phase 1 close. |
| **QuickNode achieves feature parity within 12–18 months** | Medium | Medium | Moat is engineering depth + standards authorship, not feature count. Orbital's normalized-event format becomes a Phase 2 SEP submission; once ratified, QuickNode either conforms (validating Orbital) or diverges (fragmenting Stellar). MIT licensing + edge-runtime + React hooks remain hard to replicate inside a generic multi-chain product. |
| **Soroban event API churn** | Medium | Low | The Soroban subscriber is a pluggable source feeding the same normalization pipeline; upstream churn is isolated to one file (`packages/pulse-core/src/soroban-source.ts` per `docs/ARCHITECTURE.md` §10) and does not propagate to the public `NormalizedEvent` union. |
| **Horizon → Stellar RPC migration timeline** | Medium | Medium | `CoreConfig.horizonUrl` already supports custom backends; the RPC subscriber lands as M1 in Phase 1, giving consumers a typed migration path before Horizon's deprecation horizon. |
| **Webhook secret leak in downstream consumer code** | Low | High | `WebhookDelivery` enforces HMAC-SHA256 with timing-safe comparison and SSRF block-lists by default; receivers use `verifyWebhook` (Node) or `verifyWebhookEdge` (Web Crypto) which both fail closed. See [`docs/ARCHITECTURE.md` §8](./ARCHITECTURE.md#8-trust-boundaries-and-invariants) for the full trust-boundary table. |
| **Grant-fund exhaustion before Phase 1 milestones complete** | Low | Medium | Milestones are independently shippable. M1, M3, M6 are unblocked from day one. If only $20K of $30K is consumed before pause, M1 + M3 + M6 alone produce a stability-pledged `v1.0` covering Soroban subscription, type narrowing, and the npm publish. |

---

## Budget

Total Phase 1 ask: **$30,000 USD**, milestone-released. Six months solo development plus modest mainnet infrastructure for testing.

| Line item | Allocation |
|---|---|
| Engineering — solo founder, 6 months part-time at recoverable rate | $22,000 |
| Mainnet testnet RPC node (Hetzner, $50/mo × 6) — required for M1 testing | $300 |
| Soroban contract deployment + signing fees on testnet for M2 ABI work | $200 |
| Documentation site hosting + CDN | $0 (Vercel free tier) |
| Database + auth for M5 starter boilerplates | $0 (Neon + Auth.js free tier) |
| Buffer for testnet-to-mainnet validation, security audit prep, dependency upgrades | $7,500 |

**Funding model rationale:** Orbital's commercial sustainability comes from a separately-built closed Cloud product, not from grant-dependence. SCF funding is requested to **accelerate Phase 1 delivery while the founder is unfunded**, not as the project's long-term funding mechanism. Once Phase 1 ships and Cloud begins generating revenue, the SDK family is self-sustaining without further grant support.

---

## Sustainability after Phase 1

The SDKs remain MIT and free indefinitely. Maintenance funding comes from:

1. **Orbital Cloud** — a separate closed-source managed runtime built on these SDKs, billed in USDC-on-Stellar (dogfooding the SDKs). Out of scope for this grant; mentioned only to explain why the OSS is sustainable without recurring grant ask.
2. **Drips network donations** — Orbital is registered for Stellar Wave Program issue rewards, with `Stellar Wave`–tagged issues pricing in 100/150/200-point complexity tiers.
3. **Future SCF Adopt/Audit grants** — for specific Phase 2/3 deliverables (first SEP submission, x402 reference implementation, security audit).

The grant funds the milestone, not the team's salary in perpetuity.

---

## Team

**Solo founder** (reachable at 210902543@live.unilag.edu.ng) — based in Lagos, Nigeria. Currently unfunded. Phase 0 was built in approximately 5 weeks of evenings-and-weekends work on the public repository — see commit history for cadence and quality signal.

Phase 1 will be delivered by the same founder with the same commit transparency. No subcontractors. No undisclosed contributors.

---

## Roadmap context (out of scope for this grant)

Reproduced from [`ROADMAP.md`](../ROADMAP.md) for context only — these are not Phase 1 deliverables and not part of this funding ask:

- **Phase 2 (2027)** — `@orbital-stellar/hooks` data hook library, `@orbital-stellar/payments` transaction primitives, `@orbital-stellar/auth` passkey embedded wallets, `@orbital-stellar/analytics`, **first SEP submission** formalizing the event normalization format.
- **Phase 3 (2028+)** — `@orbital-stellar/x402` payment-gated middleware, `@orbital-stellar/agent-sdk` for autonomous AI agent payments on Stellar, `@orbital-stellar/anchor-sdk` for SEP-24/SEP-31, intent compiler, shadow-fork simulator.
- **Phase 4 (long-term)** — identity layer, reactor-contract library, 10+ SEPs.

Each future phase will be a separate proposal if grant support is sought.

---

## Asks of the SCF reviewer

1. **Funding:** $30,000 milestone-released against the six M1–M6 deliverables above.
2. **Featured-project status** on Drips so contributor incentives align with Phase 1 issue throughput.
3. **Reviewer feedback on the M1–M6 merge criteria** — please challenge any milestone whose "done when" condition is not measurable.

Contact, repository links, and license are at the top of this document.

---

## References

1. Orbital repository — [`github.com/determined-001/orbital_stellar`](https://github.com/determined-001/orbital_stellar)
2. `v0.1.0` release notes — [`CHANGELOG.md`](../CHANGELOG.md)
3. Architecture reference — [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
4. Phase 0 completion snapshot — [`PROGRESS.md`](../PROGRESS.md)
5. Multi-year roadmap — [`ROADMAP.md`](../ROADMAP.md)
6. Contributor guide — [`CONTRIBUTING.md`](../CONTRIBUTING.md)
7. Security policy — [`SECURITY.md`](../SECURITY.md)
8. Stellar Development Foundation — [stellar.org](https://stellar.org)
9. Horizon API reference — [developers.stellar.org/api/horizon](https://developers.stellar.org/api/horizon)
10. Stellar RPC reference — [developers.stellar.org/api/rpc](https://developers.stellar.org/api/rpc)
11. Stellar SDF SCF program — [communityfund.stellar.org](https://communityfund.stellar.org)
12. Stellar Wave Program (Drips) — [drips.network](https://drips.network)
