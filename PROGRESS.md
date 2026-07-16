# Orbital: Progress & Status Report

**Last Updated:** 2026-07-16
**Project Status:** Core SDK family - Shipped ✅

---

## Status

Orbital is **the typed event layer for Stellar** - four MIT-licensed packages on npm that give any Stellar developer typed event subscriptions (Horizon and Soroban), signed webhook delivery with durable retry, typed ABI decoding, and React hooks, without re-implementing the plumbing.

For phase-by-phase status and release gates, see [`ROADMAP.md`](ROADMAP.md)'s [at-a-glance table](ROADMAP.md#at-a-glance). Short version: Phase 0 (Foundation) shipped 2026-05-29; Phase 1 (Production SDK) is in progress - `STABILITY.md` has merged, starter boilerplates and the `v1.0.0` tag are the only items left; Phase 2 (The Decoding Standard) and Phase 3 (Anchor Events) are next. What's explicitly out of scope while those phases are open - and why - lives in ROADMAP.md's [Frozen section](ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven).

**OSS posture:** SDKs are MIT and free indefinitely. Production hosting is the separately-built **Orbital Cloud** managed runtime, in development. Until Cloud ships, the SDKs run great in any Node.js or edge backend you operate.

---

## Project Structure

```
orbital_stellar/
├── packages/              # MIT-licensed SDKs published to npm
│   ├── pulse-core/        # Event engine - Horizon + Soroban subscription, cursor persistence
│   ├── pulse-webhooks/    # HMAC webhook delivery + verification, durable retry queues
│   ├── pulse-notify/      # React hooks
│   └── abi-registry/      # Soroban ABI client, schema helpers, registry publisher
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

### 1. `@orbital-stellar/pulse-core` - Event Engine

Subscribes to Horizon SSE and Stellar RPC (Soroban), normalizes raw operations and contract events into a typed `NormalizedEvent` taxonomy, and routes them to per-address `Watcher` instances. Handles reconnection, backoff, rate-limit responses, and cursor persistence (memory, file, Postgres, Redis, S3 adapters) automatically.

**Status:** Production-ready - full classic operation taxonomy plus Soroban contract event subscription and cursor persistence.

See [`packages/pulse-core/README.md`](./packages/pulse-core/README.md) for the API and [`packages/pulse-core/CHANGELOG.md`](./packages/pulse-core/CHANGELOG.md) for the per-feature commit trail.

### 2. `@orbital-stellar/pulse-webhooks` - Webhook Delivery

Attaches to a `Watcher` and POSTs every event to one or more endpoints with HMAC-SHA256 signing, exponential backoff retry, configurable timeout, SSRF hardening, and durable retry queues (memory, Redis, SQS adapters) that survive process restarts. `verifyWebhook` (Node) and `verifyWebhookEdge` (Web Crypto) are exported for the receiver side.

**Status:** Production-ready.

See [`packages/pulse-webhooks/README.md`](./packages/pulse-webhooks/README.md).

### 3. `@orbital-stellar/pulse-notify` - React Hooks

Browser-side React hooks (`useStellarEvent`, `useContractEvent`, `useStellarPayment`, `useStellarActivity`, `useStellarAddresses`, `useStellarHistory`) that open an SSE connection to your Orbital-powered backend and re-render on each event. Generic type narrowing supported on `useStellarEvent<T>`.

**Status:** Production-ready.

See [`packages/pulse-notify/README.md`](./packages/pulse-notify/README.md).

### 4. `@orbital-stellar/abi-registry` - ABI Registry Client

Canonical client for fetching Soroban contract ABI specs (`AbiRegistryClient` over HTTP, `LocalAbiRegistryClient` for offline/self-hosted use), plus schema validation and `scval`/JS conversion helpers. Wired into `pulse-core`'s `EventEngine` to enrich `contract.emitted` events with typed `decodedData`.

**Status:** Production-ready.

See [`packages/abi-registry/README.md`](./packages/abi-registry/README.md).

---

## Reference Composition: `apps/web` API routes

The marketing site hosts two sandboxed API routes - `app/api/events/[address]/route.ts` and `app/api/webhook-sample/route.ts` - that show how the SDKs wire together end-to-end. They are intentionally limited (one concurrent stream per IP, 25s session cap, 20s webhook-sample cooldown) so the public demo cannot exhaust Vercel resources. The limits surface upgrade-to-Cloud prompts when tripped.

For production, you have two paths:

1. **Build your own backend** - install the SDKs, wire them into your existing Node.js or edge worker, deploy on the infrastructure you already operate. The `apps/web/lib/engine.ts` + route handlers are a copy-paste starting point.
2. **Use Orbital Cloud (in development)** - managed runtime that handles multi-region orchestration, persistent webhook registries, replay, and observability. Out of scope for this repository.

---

## Development Setup

### Prerequisites
- Node.js 20 or 22 (both tested in CI)
- pnpm 10 - `npm install -g pnpm@10`

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
@orbital-stellar/pulse-core
EventEngine · Watcher · Normalization · Reconnect · Backoff · Cursor persistence
        │                                    ▲
   ┌────┴─────────────────┐                  │
   ▼                      ▼                  │
@orbital-stellar/pulse-webhooks   @orbital-stellar/pulse-notify   @orbital-stellar/abi-registry
HMAC delivery             React hooks (browser SSE)               ABI spec fetch + decode
Durable retry queues      useStellarEvent / useContractEvent       (wired into EventEngine
Edge-runtime verify       useStellarPayment / useStellarActivity    for contract.emitted)
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
- ✅ Cursor persistence (resumable streams) - `CursorStore` memory/file/Postgres/Redis/S3 adapters
- ✅ Durable retry queues - `RetryQueue` memory/Redis/SQS adapters
- ✅ Soroban event subscription via Stellar RPC
- ✅ ABI registry client for typed Soroban event decoding

---

## Scope boundaries and what's next

Production hosting - multi-region orchestration, persistent registries, leader election - belongs in **Orbital Cloud** (separate closed product), not in this repository. Everything else about what's shipped, in progress, planned, or explicitly frozen is tracked in [`ROADMAP.md`](./ROADMAP.md), including the [Frozen section](./ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven) for items intentionally out of scope. See [`docs/proposal.md`](./docs/proposal.md) for the current SCF funding proposal.

---

## How to Get Started

### As a Stellar Developer
1. Read [Getting Started](./apps/web/content/getting-started/introduction.md)
2. Install: `pnpm add @orbital-stellar/pulse-core @orbital-stellar/pulse-webhooks @orbital-stellar/pulse-notify @orbital-stellar/abi-registry`
3. Follow the [Quick Start](./apps/web/content/getting-started/quick-start.md)

### As a Contributor
1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
2. Browse [issues tagged `good-first-issue`](https://github.com/determined-001/orbital_stellar/labels/good-first-issue) - Drips Wave Program rewards apply
3. Run `pnpm -r typecheck && pnpm test` before submitting

### As a Funder / Reviewer
1. Read [`docs/proposal.md`](./docs/proposal.md) for the SCF Infrastructure Grant ask
2. See [`CHANGELOG.md`](./CHANGELOG.md) for the full commit trail

---

## Repository Health

| Metric | Status |
|---|---|
| Build Status | ✅ Passing |
| Test Coverage | ✅ Core paths covered; integration tests gated by `INTEGRATION_TESTS=true` |
| Security Scanning | ✅ CodeQL + Dependabot active |
| Documentation | ✅ Complete for the shipped SDK family |
| License | ✅ MIT |
| Workspace | ✅ pnpm 10 monorepo, Node 20 + 22 in CI |

---

## License

MIT - See [`LICENSE`](./LICENSE). Free to use in commercial and open-source projects.
