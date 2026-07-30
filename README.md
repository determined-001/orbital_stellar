# Orbital

[![npm](https://img.shields.io/npm/v/@orbital-stellar/pulse-core?style=flat-square&logo=npm&label=pulse-core)](https://www.npmjs.com/package/@orbital-stellar/pulse-core)
[![License: MIT](https://img.shields.io/github/license/determined-001/orbital_stellar?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/determined-001/orbital_stellar/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/determined-001/orbital_stellar/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-≥67%25-brightgreen?style=flat-square)](https://github.com/determined-001/orbital_stellar/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/determined-001/orbital_stellar/codeql.yml?branch=main&style=flat-square&label=codeql)](https://github.com/determined-001/orbital_stellar/actions/workflows/codeql.yml)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat-square&logo=typescript)](tsconfig.base.json)
[![Node](https://img.shields.io/badge/node-20%20%7C%2022-339933?style=flat-square&logo=node.js)](.github/workflows/ci.yml)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?style=flat-square&logo=conventionalcommits)](https://www.conventionalcommits.org)

> **Status**: `v0.1.0` on npm &nbsp;·&nbsp; **Networks**: testnet + mainnet &nbsp;·&nbsp; **License**: MIT

**Stellar's biggest developer-experience gap isn't a missing API - it's that Horizon's firehose still requires every team to build their own event delivery.**

Orbital ships that delivery layer once, openly: a typed event engine that normalizes Horizon output into application-shaped events, HMAC-signed webhook delivery with retry and edge-runtime verification, a shared ABI registry for Soroban schemas, and React hooks for live data in the browser. Four MIT-licensed packages, designed to be composed.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Packages](#packages)
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Production hosting](#production-hosting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [License](#license)

---

## Why this exists

Stellar's official APIs give you the raw firehose - and not much else:

- **Horizon SSE** drops on idle, requires backoff, surfaces raw operations rather than application-friendly events - and is [deprecated in favor of Stellar RPC](https://developers.stellar.org/docs/data/apis/migrate-from-horizon-to-rpc).
- **Stellar RPC** keeps only ~7 days of history and has no native subscription model - even with Protocol 23's unified event stream, delivery is still yours to build.
- **Webhooks** aren't part of the platform - every project rebuilds HMAC signing, retry, SSRF guards, and edge-runtime verification from scratch.
- **React integration** doesn't exist - every dashboard rebuilds SSE plumbing and lifecycle management.

Every serious Stellar app - wallet, dashboard, anchor integration, agent - re-solves the same problem. Orbital ships those primitives once so you can `pnpm add` them instead of rebuilding them.

The longer-form thesis, the multi-year vision, and the SCF grant case live in [`PROGRESS.md`](PROGRESS.md), [`ROADMAP.md`](ROADMAP.md), and `docs/proposal.md` (in progress).

---

## Packages

| Package | Description | Status |
|---|---|---|
| [`@orbital-stellar/pulse-core`](./packages/pulse-core) | EventEngine - Horizon + Soroban subscription, normalization, reconnection, rate-limit handling, cursor persistence | ✅ Shipped |
| [`@orbital-stellar/pulse-webhooks`](./packages/pulse-webhooks) | HMAC-signed webhook delivery + verification (Node + edge runtimes), durable retry queues | ✅ Shipped |
| [`@orbital-stellar/pulse-notify`](./packages/pulse-notify) | React hooks - `useStellarEvent`, `useContractEvent`, `useStellarPayment`, `useStellarActivity`, `useStellarAddresses`, `useStellarHistory`, `StellarConnectionStatus`, `StellarEventBoundary` | ✅ Shipped |
| [`@orbital-stellar/abi-registry`](./packages/abi-registry) | Canonical Soroban ABI client, schema helpers, and registry publisher interface | ✅ Shipped |

> The full classic-operation taxonomy is shipped (payments, account create/merge/options/bump-sequence, trustlines + auth, offers, claimables, liquidity pools, manage-data), alongside Soroban contract event subscription (`engine.subscribeContract`), cursor persistence, and the ABI registry client - see [`ROADMAP.md`](ROADMAP.md).

---

## Quickstart

Install only what you need from npm:

```bash
pnpm add @orbital-stellar/pulse-core             # always
pnpm add @orbital-stellar/pulse-webhooks         # if you push events to HTTPS endpoints
pnpm add @orbital-stellar/pulse-notify react     # if you render live events in React
pnpm add @orbital-stellar/abi-registry           # if you decode Soroban contract events
```

Or clone the repo to work from source:

```bash
git clone https://github.com/determined-001/orbital_stellar.git
cd orbital_stellar
pnpm install
```

### Subscribe to events directly

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";

const engine = new EventEngine({ network: "testnet" });
engine.start();

const watcher = engine.subscribe("GABC...YOUR_ACCOUNT");

watcher.on("payment.received", (event) => {
  console.log(`+${event.amount} ${event.asset} from ${event.from}`);
});

watcher.on("*", (event) => {
  // Every event for this address, regardless of type
});
```

### Deliver events to a webhook

```ts
import { EventEngine } from "@orbital-stellar/pulse-core";
import { WebhookDelivery } from "@orbital-stellar/pulse-webhooks";

const engine = new EventEngine({ network: "mainnet" });
engine.start();

const watcher = engine.subscribe("GABC...");

new WebhookDelivery(watcher, {
  url: "https://your-app.com/hooks/stellar",
  secret: process.env.WEBHOOK_SECRET!,
  retries: 3,
});
```

Receivers verify the signature with `verifyWebhook` (Node) or `verifyWebhookEdge` (Cloudflare Workers / Vercel Edge / Deno / browsers).

### Render live events in React

```tsx
"use client";
import { useStellarPayment } from "@orbital-stellar/pulse-notify";

export function IncomingPayments({ address }: { address: string }) {
  const { event, connected } = useStellarPayment(
    process.env.NEXT_PUBLIC_ORBITAL_URL!,
    address,
  );
  if (!connected) return <p>Connecting…</p>;
  if (!event) return <p>No payments yet.</p>;
  return <p>+{event.amount} {event.asset} from {event.from.slice(0, 8)}…</p>;
}
```

Run it against testnet, send a test payment from the [Stellar Laboratory](https://laboratory.stellar.org), and you'll see the event print within seconds. The full guide lives at [`apps/web/content/getting-started/quick-start.md`](apps/web/content/getting-started/quick-start.md).

---

## Architecture

```mermaid
flowchart LR
  subgraph Stellar["Stellar network"]
    Horizon["Horizon REST + SSE"]
    RPC["Stellar RPC<br/>(Soroban events)"]
  end

  subgraph Core["@orbital-stellar/pulse-core"]
    Engine["EventEngine<br/>subscribe · reconnect · backoff"]
    Watcher["Watcher<br/>per-address pub/sub"]
    Normalize["Normalize<br/>13 op types → typed events"]
    Cursor["Cursor persistence<br/>memory · file · Postgres · Redis · S3"]
  end

  subgraph Webhooks["@orbital-stellar/pulse-webhooks"]
    Sign["HMAC-SHA256<br/>+ retry + SSRF"]
    Verify["verifyWebhook<br/>verifyWebhookEdge"]
  end

  subgraph Notify["@orbital-stellar/pulse-notify"]
    Hooks["useStellarEvent<br/>useStellarPayment<br/>useStellarActivity"]
  end

  Horizon --> Engine
  RPC --> Engine
  Engine --> Normalize --> Watcher
  Engine --> Cursor
  Watcher --> Sign
  Watcher --> Hooks
  Sign -->|x-orbital-signature| YourBackend["Your endpoint"]
  YourBackend --> Verify
  Hooks --> Browser["React app"]
```

The reference composition - a Next.js route handler that subscribes to an address and streams events as SSE, plus an HMAC-signing route for the on-page webhook demo - lives in [`apps/web/app/api`](apps/web/app/api).

---

## Documentation

| Document | What it covers |
|---|---|
| [`PROGRESS.md`](PROGRESS.md) | Phase 0 completion status, project structure, architecture overview |
| [`ROADMAP.md`](ROADMAP.md) | Multi-year plan (Phase 0 → Phase 3): the decoding standard, SEP draft, anchor events |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes (top-level; per-package changelogs roll up) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, coding standards, PR process, Drips Wave Program |
| [`SECURITY.md`](SECURITY.md) | Vulnerability disclosure policy |
| [`packages/pulse-core/README.md`](packages/pulse-core/README.md) | EventEngine API, event taxonomy, configuration |
| [`packages/pulse-webhooks/README.md`](packages/pulse-webhooks/README.md) | Delivery contract, verification, SSRF safety |
| [`packages/pulse-notify/README.md`](packages/pulse-notify/README.md) | React hooks, type narrowing, authentication |
| [`packages/abi-registry/README.md`](packages/abi-registry/README.md) | ABI Registry client, publisher interface, and shared schema helpers |
| [`apps/web/README.md`](apps/web/README.md) | Marketing site + sandboxed demo API routes |

---

## Production hosting

Two paths:

1. **Build your own backend** - install the SDKs, wire them into your existing Node.js or edge worker, deploy on the infrastructure you already operate. The Next.js route handlers in [`apps/web/app/api`](apps/web/app/api) are a copy-paste reference.
2. **Use Orbital Cloud (in development)** - managed runtime handling multi-region orchestration, persistent webhook registries, replay, and observability. Out of scope for this repository.

---

## Roadmap

- **Shipped** - Full classic operation taxonomy, edge-runtime webhook verification, React hooks, Soroban event subscription, ABI registry client, cursor persistence, durable retry queues, npm publish ✅
- **v1.1.0** - Unified event ingestion via Stellar RPC (CAP-67 / Protocol 23), Horizon SSE demoted to fallback transport
- **2026 H2 (Phase 2)** - The decoding standard: SEP draft building on SEP-48, `orbital codegen`, semantic taxonomy + entity labels as open data, hosted registry
- **2027 H1 (Phase 3)** - `@orbital-stellar/anchor-sdk`, SEP-24/31 lifecycle events

Full multi-year plan in [`ROADMAP.md`](ROADMAP.md).

---

## Contributing

Contributions are welcome from the Stellar community. Start here:

- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev loop, coding standards, and PR process.
- Browse [issues tagged `good-first-issue`](https://github.com/determined-001/orbital_stellar/labels/good-first-issue) - scoped, unblocked, reviewer-ready.
- Stellar Wave Program issues are tagged `wave-program` and pay per-merge per complexity points.
- Run the test suite before submitting: `pnpm -r typecheck && pnpm test`.

All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Contributors

Thanks to everyone who has shipped code, docs, or feedback for Orbital. The list below is maintained via the [all-contributors](https://allcontributors.org) bot - see [Adding yourself to the contributors list](CONTRIBUTING.md#adding-yourself-to-the-contributors-list) to add or update your entry.

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section. Update with: npx all-contributors generate -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/determined-001"><img src="https://github.com/determined-001.png?size=100" width="100px;" alt="determined-001"/><br /><sub><b>determined-001</b></sub></a><br /><a href="https://github.com/determined-001/orbital_stellar/commits?author=determined-001" title="Code">💻</a> <a href="https://github.com/determined-001/orbital_stellar/commits?author=determined-001" title="Documentation">📖</a> <a href="#infra-determined-001" title="Infrastructure">🏗️</a> <a href="#maintenance-determined-001" title="Maintenance">🚧</a> <a href="#projectManagement-determined-001" title="Project Management">📆</a> <a href="https://github.com/determined-001/orbital_stellar/pulls?q=is%3Apr+reviewed-by%3Adetermined-001" title="Reviewed Pull Requests">👀</a> <a href="https://github.com/determined-001/orbital_stellar/commits?author=determined-001" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Trovicdev"><img src="https://github.com/Trovicdev.png?size=100" width="100px;" alt="Trovicdev"/><br /><sub><b>Trovicdev</b></sub></a><br /><a href="https://github.com/determined-001/orbital_stellar/commits?author=Trovicdev" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Praxhant97"><img src="https://github.com/Praxhant97.png?size=100" width="100px;" alt="Praxhant97"/><br /><sub><b>Praxhant97</b></sub></a><br /><a href="https://github.com/determined-001/orbital_stellar/commits?author=Praxhant97" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Chrisbankz0"><img src="https://github.com/Chrisbankz0.png?size=100" width="100px;" alt="Christopher Umechukwu"/><br /><sub><b>Christopher Umechukwu</b></sub></a><br /><a href="https://github.com/determined-001/orbital_stellar/commits?author=Chrisbankz0" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/3m1n3nc3"><img src="https://github.com/3m1n3nc3.png?size=100" width="100px;" alt="Legacy"/><br /><sub><b>Legacy</b></sub></a><br /><a href="https://github.com/determined-001/orbital_stellar/commits?author=3m1n3nc3" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

Emoji key follows the [all-contributors](https://allcontributors.org/docs/en/emoji-key) spec - 💻 code · 📖 docs · 🎨 design · 🏗️ infrastructure · 🚧 maintenance · 📆 project management · 👀 reviewed PRs · ⚠️ tests.

The list above is the curated **all-contributors** set. For the full commit history including every contributor not yet recognized here, see [GitHub's contributor graph](https://github.com/determined-001/orbital_stellar/graphs/contributors) - if your name is there and not in the table, please [open an issue](https://github.com/determined-001/orbital_stellar/issues/new) or comment `@all-contributors please add @your-username for code` on any issue and the bot will add you.

---

## License

[MIT](LICENSE) - free to use in commercial and open-source projects.

---

## Community

- [GitHub Discussions](https://github.com/determined-001/orbital_stellar/discussions) - questions, ideas, design discussion, and help.
- Twitter: _(handle pending)_
- Discord: _(invite pending)_
