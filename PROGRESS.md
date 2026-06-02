# Orbital: Progress & Status Report

**Last Updated:** 2026-05-07
**Project Status:** Phase 0 (SDK Foundation) — Complete ✅
**Next Milestone:** Phase 1 — Production-grade `v1.0` (Q2–Q3 2026)

---

## Executive Summary

Orbital is **Stellar's open-source real-time event SDK family** — three MIT-licensed packages on npm that give any Stellar developer typed event subscriptions, signed webhook delivery, and React hooks without re-implementing the plumbing.

**Current Status:** Phase 0 (Foundation) is complete. The full classic operation taxonomy is shipped, edge-runtime webhook verification works on Cloudflare Workers and Vercel Edge, and React hooks are in production-shape. Phase 1 (Soroban event subscription, ABI registry, `v1.0` stability pledge, npm publish) begins Q2 2026.

**OSS posture:** SDKs are MIT and free indefinitely. Production hosting is the separately-built **Orbital Cloud** managed runtime, in development. Until Cloud ships, the SDKs run great in any Node.js or edge backend you operate.

---

## What Has Been Completed

### Phase 0 — Foundation ✅

All three packages are feature-complete for Phase 0 scope and ready for use against testnet today:

| Component | Status | Details |
|---|---|---|
| Classic operation event streaming via Horizon SSE | ✅ Done | Horizon subscription, automatic reconnection with AWS Full Jitter backoff |
| Full classic operation taxonomy | ✅ Done | Payments (received/sent/self), account create/merge/bump-sequence, trustlines (change/allow/set_flags), DEX offers (created/updated/deleted), claimable balances (created/claimed), liquidity pools (deposit/withdraw), `manage_data` (set/cleared) |
| HMAC-signed webhook delivery | ✅ Done | Retry, exponential backoff, concurrent-retry caps, configurable timeout |
| Edge-runtime webhook verification | ✅ Done | `verifyWebhookEdge` for Cloudflare Workers and Vercel Edge (Web Crypto API) |
| React hooks (`useStellarEvent`, `useStellarPayment`, `useStellarActivity`) | ✅ Done | Type-narrowing generic on `useStellarEvent`, multi-event subscription, stable config rules |
| Custom Horizon URL override | ✅ Done | `CoreConfig.horizonUrl` for self-hosted nodes / regional mirrors / futurenet |
| Engine lifecycle notifications | ✅ Done | `engine.reconnecting`, `engine.reconnected`, `engine.rate_limited`, `engine.stopped` |
| Public marketing + documentation site (`apps/web`) | ✅ Done | Next.js 16, Tailwind CSS 4. Hosts the docs, the sandboxed `/api/events/[address]` SSE demo, and the `/api/webhook-sample` signing demo. |
| Testnet + mainnet support | ✅ Done | Network selector via `network: "mainnet" \| "testnet"` |
| CI/CD pipeline | ✅ Done | GitHub Actions on Node 20 and 22, CodeQL, Dependabot |
| MIT License & open-source setup | ✅ Done | `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` |

---

## Project Structure

```
orbital_stellar/
├── packages/              # MIT-licensed SDKs published to npm
│   ├── pulse-core/        # Event engine — Horizon + Soroban subscription
│   ├── pulse-webhooks/    # HMAC webhook delivery + verification
│   └── pulse-notify/      # React hooks
├── apps/
│   └── web/               # Marketing + docs site + sandboxed demo API routes (Vercel)
├── docs/
│   └── proposal.md        # SCF Infrastructure Grant proposal
├── README.md              # Project overview
├── ROADMAP.md             # Multi-year vision
├── CHANGELOG.md           # Release notes (rolls up per-package changelogs)
├── CONTRIBUTING.md        # Setup, coding standards, PR process, Drips Wave
├── SECURITY.md            # Vulnerability disclosure policy
└── LICENSE                # MIT
```

---

## Core Packages

### 1. `@orbital/pulse-core` — Event Engine

Subscribes to Horizon SSE, normalizes raw operations into a typed `NormalizedEvent` taxonomy, and routes them to per-address `Watcher` instances. Handles reconnection, backoff, and rate-limit responses automatically.

**Status:** Production-ready for Phase 0 scope (full classic operation taxonomy). Soroban event subscription is Phase 1.

See [`packages/pulse-core/README.md`](./packages/pulse-core/README.md) for the API and [`packages/pulse-core/CHANGELOG.md`](./packages/pulse-core/CHANGELOG.md) for the per-feature commit trail.

### 2. `@orbital/pulse-webhooks` — Webhook Delivery

Attaches to a `Watcher` and POSTs every event to one or more endpoints with HMAC-SHA256 signing, exponential backoff retry, configurable timeout, and SSRF hardening. `verifyWebhook` (Node) and `verifyWebhookEdge` (Web Crypto) are exported for the receiver side.

**Status:** Production-ready for Phase 0 scope.

See [`packages/pulse-webhooks/README.md`](./packages/pulse-webhooks/README.md).

### 3. `@orbital/pulse-notify` — React Hooks

Browser-side React hooks (`useStellarEvent`, `useStellarPayment`, `useStellarActivity`) that open an SSE connection to your Orbital-powered backend and re-render on each event. Generic type narrowing supported on `useStellarEvent<T>`.

**Status:** Production-ready for Phase 0 scope.

See [`packages/pulse-notify/README.md`](./packages/pulse-notify/README.md).

---

## Reference Composition: `apps/web` API routes

The marketing site hosts two sandboxed API routes — `app/api/events/[address]/route.ts` and `app/api/webhook-sample/route.ts` — that show how the SDKs wire together end-to-end. They are intentionally limited (one concurrent stream per IP, 25s session cap, 20s webhook-sample cooldown) so the public demo cannot exhaust Vercel resources. The limits surface upgrade-to-Cloud prompts when tripped.

For production, you have two paths:

1. **Build your own backend** — install the SDKs, wire them into your existing Node.js or edge worker, deploy on the infrastructure you already operate. The `apps/web/lib/engine.ts` + route handlers are a copy-paste starting point.
2. **Use Orbital Cloud (in development)** — managed runtime that handles multi-region orchestration, persistent webhook registries, replay, and observability. Out of scope for this repository.

---

## Development Setup

### Prerequisites
- Node.js 20 or 22 (both tested in CI)
- pnpm 10 — `npm install -g pnpm@10`

### Install & Run

```bash
pnpm install
pnpm -r typecheck
pnpm test

# Run integration tests (requires INTEGRATION_TESTS=true)
pnpm test:integration

# Run the docs site + sandboxed demo API
NEXT_PUBLIC_NETWORK=testnet pnpm --filter orbital/web dev
```

---

## Architecture

```
Stellar Network (Horizon REST/SSE + Stellar RPC)
        │
        ▼
@orbital/pulse-core
EventEngine · Watcher · Normalization · Reconnect · Backoff
        │
   ┌────┴─────────────────┐
   ▼                      ▼
@orbital/pulse-webhooks   @orbital/pulse-notify
HMAC delivery             React hooks (browser SSE)
SSRF hardening            useStellarEvent
Edge-runtime verify       useStellarPayment
                          useStellarActivity
```

---

## Security

### Implemented
- ✅ HMAC-SHA256 webhook signatures (`X-Orbital-Signature`, `X-Orbital-Timestamp`)
- ✅ Timing-safe HMAC comparison (`crypto.timingSafeEqual` / Web Crypto equivalent)
- ✅ SSRF protection (private/loopback/link-local IP ranges blocked, DNS rebinding defense)
- ✅ Per-attempt webhook delivery timeout (default 10s)
- ✅ Concurrent-retry cap to prevent unbounded memory growth on unreachable endpoints
- ✅ Security disclosure policy (`SECURITY.md`)
- ✅ CodeQL static analysis on every PR
- ✅ Dependabot for dependency CVE tracking

### Phase 1 Scope
- 🔲 Cursor persistence (resumable streams)
- 🔲 Pluggable durable adapters (Redis, Postgres, S3) for replay
- 🔲 Soroban event subscription via Stellar RPC
- 🔲 ABI registry client for typed Soroban event decoding

---

## Phase 0 Scope Boundaries

These are **not** in Phase 0 and are tracked for Phase 1 or later:

1. **Soroban events** — contract event subscription via Stellar RPC. Phase 1.
2. **Cursor persistence** — resumable streams across process restarts. Phase 1.
3. **Webhook replay store** — durable retry adapters for Redis/Postgres/S3. Phase 1.
4. **Production hosting** — multi-region orchestration, persistent registries, leader election. Belongs in **Orbital Cloud** (separate closed product), not in this repository.
5. **`@orbital/hooks`, `@orbital/payments`, `@orbital/auth`** — Phase 2 SDK family. See [`ROADMAP.md`](./ROADMAP.md).
6. **`@orbital/x402`, `@orbital/agent-sdk`** — Phase 3. See [`ROADMAP.md`](./ROADMAP.md).

---

## Next Steps: Phase 1 (Q2–Q3 2026)

| Milestone | Q2 2026 | Q3 2026 |
|---|---|---|
| **Events** | Soroban event subscription (Stellar RPC) | ABI registry client for typed decoding |
| **Types** | Discriminated union refinement (exhaustive `switch`) | — |
| **Persistence** | Cursor persistence in `pulse-core` | Pluggable replay adapters in `pulse-webhooks` |
| **Distribution** | Starter boilerplates (`next`, `express`, `anchor`) | npm publish under `@orbital/` |
| **Stability** | — | `v1.0` stability pledge — semver contract |

See [`ROADMAP.md`](./ROADMAP.md) for the full multi-year vision and [`docs/proposal.md`](./docs/proposal.md) for the Phase 1 SCF funding proposal.

---

## How to Get Started

### As a Stellar Developer
1. Read [Getting Started](./apps/web/content/getting-started/introduction.md)
2. Install: `pnpm add @orbital/pulse-core @orbital/pulse-webhooks @orbital/pulse-notify`
3. Follow the [Quick Start](./apps/web/content/getting-started/quick-start.md)

### As a Contributor
1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
2. Browse [issues tagged `good-first-issue`](https://github.com/orbital/orbital/labels/good-first-issue) — Drips Wave Program rewards apply
3. Run `pnpm -r typecheck && pnpm test` before submitting

### As a Funder / Reviewer
1. Read [`docs/proposal.md`](./docs/proposal.md) for the SCF Infrastructure Grant ask
2. See [`CHANGELOG.md`](./CHANGELOG.md) for the Phase 0 commit trail

---

## Repository Health

| Metric | Status |
|---|---|
| Build Status | ✅ Passing |
| Test Coverage | ✅ Core paths covered; integration tests gated by `INTEGRATION_TESTS=true` |
| Security Scanning | ✅ CodeQL + Dependabot active |
| Documentation | ✅ Complete for Phase 0 |
| License | ✅ MIT |
| Workspace | ✅ pnpm 10 monorepo, Node 20 + 22 in CI |

---

## License

MIT — See [`LICENSE`](./LICENSE). Free to use in commercial and open-source projects.
