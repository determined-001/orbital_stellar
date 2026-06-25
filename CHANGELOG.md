# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file rolls up changes across the public packages: `@orbital-stellar/pulse-core`,
`@orbital-stellar/pulse-webhooks`, and `@orbital-stellar/pulse-notify`. Per-package changelogs
live in each package directory.

## [Unreleased]

### Added

### Changed

### Fixed

### Security

---

## [0.1.0] — 2026-05-28

First versioned release. The three packages cover the full Stellar classic
operation taxonomy and are stable for testnet development today. Soroban
event subscription, cursor persistence, and the `v1.0` stability pledge ship
in Phase 1 (Q2–Q3 2026).

### Added

- `@orbital-stellar/pulse-core`: `EventEngine` — Horizon SSE subscription with AWS
  Full-Jitter exponential backoff, automatic reconnection, and a per-address
  `Watcher` pub/sub model built on Node's `EventEmitter`.
- `@orbital-stellar/pulse-core`: full classic operation taxonomy normalized into a
  typed `NormalizedEvent` discriminated union:
  - Payments: `payment.received`, `payment.sent`, `payment.self`
  - Accounts: `account.created`, `account.merged`, `account.options_changed`,
    `account.bump_sequence`
  - Trustlines: `trustline.added`, `trustline.updated`, `trustline.removed`,
    `trustline.authorized`, `trustline.deauthorized`
  - DEX offers: `offer.created`, `offer.updated`, `offer.deleted`
  - Claimable balances: `claimable.created`, `claimable.claimed`
  - Liquidity pools: `lp.deposited`, `lp.withdrawn`
  - Data entries: `data.set`, `data.cleared`
- `@orbital-stellar/pulse-core`: lifecycle notifications — `engine.reconnecting`,
  `engine.reconnected`, `engine.rate_limited` (with parsed `Retry-After`),
  and `engine.stopped`.
- `@orbital-stellar/pulse-core`: `CoreConfig.horizonUrl` override for self-hosted
  Horizon nodes, regional mirrors, and futurenet.
- `@orbital-stellar/pulse-core`: `EventEngine.unsubscribeAll()` to drain watchers
  without closing the SSE stream.
- `@orbital-stellar/pulse-core`: optional `filter` predicate on
  `EventEngine.subscribe()` for per-watcher event suppression.
- `@orbital-stellar/pulse-webhooks`: `WebhookDelivery` with HMAC-SHA256 signing
  (`x-orbital-signature`, `x-orbital-timestamp`, `x-orbital-attempt`),
  exponential-backoff retry with jitter, per-attempt `AbortController`
  timeout, and a concurrent-retry cap.
- `@orbital-stellar/pulse-webhooks`: `verifyWebhook` (Node `crypto`, timing-safe
  comparison) and `verifyWebhookEdge` (Web Crypto) for Cloudflare Workers,
  Vercel Edge, Deno, and browsers.
- `@orbital-stellar/pulse-notify`: `useStellarEvent<T>` with generic type narrowing,
  positional and config-object call signatures, and stable dep-array keys
  for array event allowlists.
- `@orbital-stellar/pulse-notify`: `useStellarPayment` and `useStellarActivity`
  convenience hooks.
- `@orbital-stellar/pulse-core`: testnet + mainnet network selectors via
  `network: "mainnet" | "testnet"`.

### Changed

- `@orbital-stellar/pulse-core`: `EventEngine.start()` now returns a boolean
  (`true` on a fresh start, `false` if the engine was already running). Pass
  `{ strict: true }` to throw `EngineAlreadyStartedError` instead.
- `@orbital-stellar/pulse-core`: `WatcherNotification.timestamp` renamed to
  `emittedAt` to distinguish it from the on-chain `created_at` timestamp
  used in operation events.
- `@orbital-stellar/pulse-core`: self-payments where `from === to` now emit a single
  `payment.self` event instead of separate `payment.received` and
  `payment.sent` events.

### Fixed

- `@orbital-stellar/pulse-webhooks`: cap concurrent retries to prevent unbounded
  memory growth when consumer endpoints are unreachable.
- `@orbital-stellar/pulse-core`: align reconnect attempt numbers across logs and
  `engine.reconnecting` notifications.
- `@orbital-stellar/pulse-core`: warn when listeners are added after `Watcher.stop()`.

### Security

- `@orbital-stellar/pulse-webhooks`: timing-safe HMAC comparison via
  `crypto.timingSafeEqual` (Node) and constant-time XOR (Web Crypto).
- `@orbital-stellar/pulse-webhooks`: SSRF hardening on delivery targets — private,
  loopback, and link-local IP ranges are blocked by default, with DNS
  rebinding defense.
- Strict TypeScript across all packages (`noUncheckedIndexedAccess`,
  `strict`, NodeNext module resolution).
- CI matrix runs on Node 20 and Node 22 with CodeQL static analysis and
  Dependabot CVE tracking.

### Impact

- Stellar developers can subscribe to every classic operation type with one
  typed API, deliver events to HTTPS endpoints with retry and signature
  verification baked in, and render live data in React without writing SSE
  plumbing.
- Edge-runtime verification unblocks webhook receivers on Cloudflare
  Workers and Vercel Edge — a deployment surface QuickNode and Moralis do
  not natively support for Stellar.
- The reference composition (`apps/web/app/api/events/[address]/route.ts`)
  is now a single Next.js file rather than a separate Express server, so
  there is one runtime to deploy when self-hosting the SDKs end-to-end.

### Known limitations

- Soroban contract events (`invoke_host_function`) are not yet normalized
  — Phase 1.
- Webhook retries are in-process; restarting loses pending retries.
  Persistent retry queues ship in Phase 1 alongside cursor persistence.
- Packages are not yet published to npm. Until `v0.1.0` is tagged and
  released, consume via `pnpm install` against the workspace.
