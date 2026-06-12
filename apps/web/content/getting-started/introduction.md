---
title: Introduction
description: What Orbital is and why you need it.
---

## What is Orbital?

Orbital is **Stellar's open-source real-time event SDK family** — three MIT-licensed packages on npm that turn Horizon and Stellar RPC's raw firehose into typed, application-shaped events you can subscribe to in any Node.js, edge, or React runtime.

- **`@orbital-stellar/pulse-core`** — event engine: Horizon SSE subscription, normalization, reconnection, rate-limit handling
- **`@orbital-stellar/pulse-webhooks`** — HMAC-signed webhook delivery (Node) and verification (Node + edge runtimes)
- **`@orbital-stellar/pulse-notify`** — React hooks for live events in the browser

## Why use it?

Stellar's official APIs give you the raw firehose:

- **Horizon SSE** drops on idle, requires backoff, has no replay, and surfaces raw operations rather than application-friendly events.
- **Stellar RPC** keeps only ~7 days of Soroban history and has no native subscription model.
- **Webhooks** aren't part of the platform — every project rebuilds HMAC signing, retry, SSRF guards, and edge-runtime verification from scratch.
- **React integration** doesn't exist — every dashboard rebuilds SSE plumbing and lifecycle management.

Orbital ships those primitives once, openly, so you can `pnpm add` them instead of rebuilding them.

## Architecture

```
Stellar Network (Horizon REST/SSE + Stellar RPC)
        │
        ▼
  @orbital-stellar/pulse-core
  EventEngine · Watcher · Normalization · Reconnect
        │
   ┌────┴─────────────────┐
   ▼                      ▼
@orbital-stellar/pulse-webhooks   @orbital-stellar/pulse-notify
HMAC delivery (Node)      React hooks (browser SSE)
Edge verification         useStellarEvent, useStellarPayment
```

## Packages

| Package | Description |
|---------|-------------|
| `@orbital-stellar/pulse-core` | Event engine: Horizon subscription, event normalization, reconnection |
| `@orbital-stellar/pulse-webhooks` | HMAC-signed webhook delivery + verification (Node + edge runtimes) |
| `@orbital-stellar/pulse-notify` | React hooks for client-side event subscription |

## Event taxonomy

Orbital normalizes the full Stellar classic operation set into a typed `NormalizedEvent` union. The current taxonomy includes:

- **Payments** — `payment.received`, `payment.sent`, `payment.self`
- **Accounts** — `account.created`, `account.merged`, `account.options_changed`, `account.bump_sequence`
- **Trustlines** — `trustline.added`, `trustline.updated`, `trustline.removed`, `trustline.authorized`, `trustline.deauthorized`
- **DEX offers** — `offer.created`, `offer.updated`, `offer.deleted`
- **Claimable balances** — `claimable.created`, `claimable.claimed`
- **Liquidity pools** — `lp.deposited`, `lp.withdrawn`
- **Data entries** — `data.set`, `data.cleared`

Soroban contract events are coming in Phase 1 (Q2–Q3 2026). See the [roadmap](https://github.com/orbital/orbital/blob/main/ROADMAP.md).

## Production hosting

You install the SDKs into your own Node.js or edge backend and operate them on the infrastructure you already use. A separately-built **Orbital Cloud** managed runtime — multi-region orchestration, persistent webhook registries, replay, observability — is in development for teams who don't want to operate event subscriptions themselves.

A reference Next.js composition lives at `apps/web/app/api/events/[address]/route.ts` in the GitHub repo — copy and adapt it if you want to see the SDKs wired together end-to-end before building your own backend.
