# Orbital — Open Source Policy

> **TL;DR.** Every package in this repository is MIT and stays MIT forever.
> Everything in this repository — every SDK, schema, reference implementation,
> test, and ADR — is committed open. Closed-source code lives in a separate
> repository (Orbital Cloud), imports the public packages from npm, and is
> never folded back into this one.
>
> If you are filing a PR against this repository, this document tells you
> exactly what you are contributing to and what will and will not change
> about that commitment over time.

---

## Table of contents

1. [The model in one sentence](#the-model-in-one-sentence)
2. [What stays MIT, forever](#what-stays-mit-forever)
3. [What Orbital monetizes (never open-sourced)](#what-orbital-monetizes-never-open-sourced)
4. [The architectural boundary](#the-architectural-boundary)
5. [Contributor guidance — will my PR be accepted?](#contributor-guidance--will-my-pr-be-accepted)
6. [License commitment](#license-commitment)
7. [What is not yet decided](#what-is-not-yet-decided)
8. [Changing this policy](#changing-this-policy)

---

## The model in one sentence

**Orbital follows the Vercel / Clerk / Auth0 model: open-source SDKs and standards, monetized operations and certifications.** The SDKs are the protocol; the closed Cloud product is operating that protocol at production scale with multi-tenancy, compliance certifications, and SLAs.

This is deliberately **not** the Supabase / MongoDB / Elastic model — Orbital does not open-source the server. The reason is operational, not ideological: open-sourcing the production server creates asymmetric infrastructure-cost exposure (anyone can run it, only Orbital pays to maintain it at scale) and historically destroys the project's ability to keep maintaining the OSS once the grant-funding window closes.

Capture the category in open source. Capture the revenue in operations. Never confuse the two.

---

## What stays MIT, forever

Everything below is in `packages/` or `apps/` today, or will be added to one of them. All of it is MIT-licensed via the [`LICENSE`](../LICENSE) at the repo root.

### Today (Phase 0, `v0.1.0`)

- `@orbital/pulse-core` — EventEngine, Watcher, normalization layer, reconnection state machine
- `@orbital/pulse-webhooks` — `WebhookDelivery`, `verifyWebhook`, `verifyWebhookEdge`
- `@orbital/pulse-notify` — `useStellarEvent`, `useStellarPayment`, `useStellarActivity`
- Event schemas — the `NormalizedEvent` discriminated union and per-event TypeScript shapes
- Webhook delivery contract — header format, signing scheme, retry rules
- Reference composition — the Next.js route handlers in `apps/web/app/api/*` that wire the three packages together end-to-end
- All test suites
- All ADRs (`docs/adr/`)
- Marketing + documentation site source (`apps/web/`)
- Per-package READMEs, CONTRIBUTING, SECURITY, CHANGELOG

### Phase 1 (`v1.0`, Q2–Q3 2026)

- Soroban event subscriber (plug into the same normalization pipeline)
- ABI Registry client library, schema, and RegistryPublisher interface
- Cursor persistence **interface** + the in-memory and on-disk reference adapters
- Replay-queue **interface** + the in-memory reference adapter
- Starter boilerplates (`orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`)

### ABI Registry

`@orbital/abi-registry` is the MIT package surface for Soroban ABI client code, schema helpers, and publishing interfaces.

- Technical map: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Package README: [`packages/abi-registry/README.md`](../packages/abi-registry/README.md)

The hosted verification / publishing service remains a separate Cloud product. The schema, client, and decoder helpers in this repository stay open.

### Phase 2 (2027)

- `@orbital/hooks` — `useAccount`, `useBalance`, `useTransaction`, `useOrderBook`
- `@orbital/payments` — send, receive, path-payment, payroll-batch primitives
- `@orbital/auth` — WebAuthn / passkey embedded wallet SDK
- `@orbital/analytics` — client library + event-volume reference dashboards
- First SEP submission — formalized event normalization format
- Reference reactor contracts (Soroban Rust, open for anyone to fork)

### Phase 3 (2028+)

- `@orbital/x402` — Express / Next.js middleware for payment-gated API access
- `@orbital/agent-sdk` — payment client for autonomous AI agents
- `@orbital/anchor-sdk` — SEP-24 / SEP-31 lifecycle client
- Intent compiler — at maturity, the DSL + graph runtime become OSS
- Shadow-fork simulator OSS core
- ZK-proof generation library (Noir / RiscZero circuits) — runnable locally

**Rule of thumb for what lands here:** if a competent engineer would expect to `pnpm add` it and use it in a private project, it's MIT.

---

## What Orbital monetizes (never open-sourced)

These live in a **separate private repository** (Orbital Cloud) that imports the public packages from npm. They are never folded back into this repository.

| Category | Examples |
|---|---|
| **Operated infrastructure** | Hosted Stellar nodes, multi-region orchestrator, archival database, delivery network, dead-letter queue UI |
| **Multi-tenant control plane** | Auth, billing, RBAC, key scoping, rate limiting, per-customer event isolation, OAuth, audit log |
| **Compliance certifications** | SOC 2 Type II, PCI-DSS, ISO 27001, regulator-accepted audit-log exports |
| **Enterprise features** | Dedicated tenancy, sovereign deployment (EU / India / CBDC), 99.99% contractual SLAs, named CSM, 24/7 on-call |
| **ZK attestations at scale** | Proof production with managed keys / TEEs / enterprise API |
| **Compliance export engine** | FATF travel rule, OFAC screening, SAR formatters, SEP-24 / SEP-31 lifecycle exports |
| **Priority / latency markets** | Sub-100ms guaranteed delivery tier; off-chain auction matching publishers to subscribers by priority |
| **Parametric insurance** | Missed-webhook payouts from a collateralized pool |
| **Proprietary datasets** | Aggregate analytics derived from operating, not raw event data |
| **Hosted ABI Registry** | The verification / publishing service operated by Orbital (the **schema** and **client** are MIT — only the hosted service is closed) |

**Rule of thumb for what lives there:** if the value comes from **operating** something at scale or **certifying** it, it's closed. If the value comes from the **code itself**, it's open.

---

## The architectural boundary

The public packages expose **interfaces**; the private repository ships **adapters** against those interfaces. The interfaces stay MIT; the adapters can be closed.

Examples of the boundary, today and in Phase 1:

| Public interface (MIT) | Private adapter (Closed) |
|---|---|
| `CoreConfig.horizonUrl` | Orbital-operated mainnet Horizon node behind an authenticated endpoint |
| `CoreConfig.cursorStore` *(Phase 1)* | Multi-region Postgres cursor store with consensus on dedup |
| `WebhookDelivery.retryQueue` *(Phase 1)* | Managed Redis / Postgres queue with manual replay UI |
| `WebhookDelivery` event handlers (`webhook.failed`, `webhook.dropped`) | Hosted dead-letter explorer and forensics console |
| `EventEngine.subscribe(address, { filter })` | Hosted address-and-event-type RBAC scopes |

This split lets us ship enterprise features without forking `pulse-core`, and lets self-hosters keep parity with Cloud for the parts that matter (correctness, security, performance).

---

## Contributor guidance — will my PR be accepted?

A short decision aid before you open a PR.

### Likely to be accepted

- Fixing a bug in `pulse-core`, `pulse-webhooks`, or `pulse-notify`
- Adding a new normalized event type (Soroban contract events, future Stellar protocol additions)
- Improving test coverage
- Improving the public docs in `apps/web/content/` or `docs/`
- Adding a starter boilerplate or example
- Refining an existing interface so adapters slot in more cleanly
- Adding a Soroban ABI Registry client / decoder
- Improving the reference composition in `apps/web/app/api/*`

### Will not be accepted (belongs in private Cloud)

- Persistent webhook registry with Postgres / Redis / Dynamo
- Multi-tenant auth, billing, or per-customer rate limiting
- Compliance export adapters (FATF, OFAC, SAR)
- Centralized observability / analytics services
- Hosted dashboards beyond the marketing-demo sandbox
- Anything that would require Orbital to operate infrastructure on the contributor's behalf

### Uncertain — please discuss in an issue first

- Intent DSL / graph compiler interfaces (Phase 3; the **runtime** is OSS at maturity, the **hosted compilation service** is not)
- Shadow-fork simulator extensions (Phase 3; OSS core, hosted SaaS version closed)
- Reactor contract reference library (Phase 2; reference contracts are OSS, the certification / accreditation service is closed)

If you are not sure where a PR falls, open an issue with the `policy-question` label before investing time. We will tell you in 48 hours.

---

## License commitment

- **All current packages** ship under MIT and will not be relicensed. Specifically, Orbital commits to **not** adopting source-available licenses (SSPL, BSL, Elastic License, Functional Source License, or successors) for any code that has shipped under MIT.
- **All future SDK packages** under the `@orbital/` namespace will ship under MIT.
- **Reference implementations, schemas, and specs** ship under MIT. This includes the event normalization format, the webhook delivery contract, and the Soroban ABI Registry schema.
- **The marketing and documentation site** (`apps/web/`) is MIT — you may fork and adapt it.

If Orbital is ever acquired or restructured, the MIT licenses already granted are irrevocable for the code that has shipped under them. The strongest guarantee a contributor can rely on is the public commit history under this license.

---

## What is not yet decided

These are honest uncertainties as of `v0.1.0`. They will be resolved in writing here when the decision is made.

| Question | Status |
|---|---|
| Will the Soroban ABI Registry **data** (the published contract schemas) be a public good or a paid dataset? | The **client** and **schema** are MIT. The **hosted service** is currently planned as a free public good, with a paid tier for high-volume integrators. Final structure TBD by Phase 1 close. |
| Will the intent compiler ship as runnable-locally OSS at maturity (Phase 3)? | Current intent is yes — see [`ROADMAP.md`](../ROADMAP.md) Phase 3. Subject to scope decomposition closer to Phase 2 close. |
| Will the reactor-contract certification service be Orbital-operated or community-governed? | TBD. The contracts themselves are MIT; the certification service may be operated commercially or via an Orbital Foundation. |

When these resolve, the row will be moved to §2 or §3 as appropriate.

---

## Changing this policy

This document is the public contract Orbital makes with its contributors and consumers. Material changes follow a public process:

1. A pull request to this file, with the rationale in the PR description.
2. A 14-day public comment window via GitHub Discussions.
3. Sign-off from the maintainer, recorded in the merged PR.

Changes that **remove items from §2 (MIT) or add items to §3 (Closed)** are subject to the constraint that already-shipped code under MIT remains MIT — see [License commitment](#license-commitment). New scope can be assigned to either column; existing scope cannot move from open to closed.

Editorial changes (typos, link updates, doc references) follow the normal PR flow without the comment window.

---

## Related documents

- [`LICENSE`](../LICENSE) — the MIT license text
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — the technical map, including extension-point interfaces
- [`docs/proposal.md`](./proposal.md) — the SCF grant case
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the dev loop and PR process
- [`SECURITY.md`](../SECURITY.md) — vulnerability disclosure policy
- [`ROADMAP.md`](../ROADMAP.md) — multi-year phase plan
