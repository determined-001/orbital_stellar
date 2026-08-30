# Orbital - Open Source Policy

> **TL;DR.** Every package in this repository is MIT and stays MIT forever.
> Everything in this repository - every SDK, schema, reference implementation,
> test, and ADR - is committed open. Closed-source code lives in a separate
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
5. [Contributor guidance - will my PR be accepted?](#contributor-guidance--will-my-pr-be-accepted)
6. [License commitment](#license-commitment)
7. [What is not yet decided](#what-is-not-yet-decided)
8. [Changing this policy](#changing-this-policy)

---

## The model in one sentence

**Orbital follows the Vercel / Clerk / Auth0 model: open-source SDKs and standards, monetized operations and certifications.** The SDKs are the protocol; the closed Cloud product is operating that protocol at production scale with multi-tenancy, compliance certifications, and SLAs.

This is deliberately **not** the Supabase / MongoDB / Elastic model - Orbital does not open-source the server. The reason is operational, not ideological: open-sourcing the production server creates asymmetric infrastructure-cost exposure (anyone can run it, only Orbital pays to maintain it at scale) and historically destroys the project's ability to keep maintaining the OSS once the grant-funding window closes.

Capture the category in open source. Capture the revenue in operations. Never confuse the two.

---

## What stays MIT, forever

Everything below is in `packages/` or `apps/` today, or will be added to one of them. All of it is MIT-licensed via the [`LICENSE`](../LICENSE) at the repo root.

### Shipped today

- `@orbital-stellar/pulse-core` - EventEngine, Watcher, normalization layer, reconnection state machine, Soroban event subscriber, cursor persistence (`CursorStore` interface + memory/file/Postgres/Redis/S3 adapters)
- `@orbital-stellar/pulse-webhooks` - `WebhookDelivery`, `verifyWebhook`, `verifyWebhookEdge`, durable retry queues (`RetryQueue` interface + memory/Redis/SQS adapters)
- `@orbital-stellar/pulse-notify` - `useStellarEvent`, `useContractEvent`, `useStellarPayment`, `useStellarActivity`, `useStellarAddresses`, `useStellarHistory`
- `@orbital-stellar/abi-registry` - ABI Registry client library, schema, and `RegistryPublisher` interface
- Event schemas - the `NormalizedEvent` discriminated union and per-event TypeScript shapes, including `contract.invoked` / `contract.emitted`
- Webhook delivery contract - header format, signing scheme, retry rules
- Reference composition - the Next.js route handlers in `apps/web/app/api/*` that wire the packages together end-to-end
- All test suites
- All ADRs (`docs/adr/`)
- Marketing + documentation site source (`apps/web/`)
- Per-package READMEs, CONTRIBUTING, SECURITY, CHANGELOG

### Remaining Phase 1 work

- Starter boilerplates (`orbital-next-starter`, `orbital-express-starter`, `orbital-anchor-starter`)
- `v1.0.0` git tag with full release notes

`v1.0` stability pledge (`STABILITY.md`) has shipped - see [`STABILITY.md`](../STABILITY.md). The ABI Registry schema SEP draft and hosted registry service moved to Phase 2 (below) as of the roadmap refocus - see [ROADMAP.md](../ROADMAP.md).

### ABI Registry

`@orbital-stellar/abi-registry` is the MIT package surface for Soroban ABI client code, schema helpers, and publishing interfaces.

- Technical map: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Package README: [`packages/abi-registry/README.md`](../packages/abi-registry/README.md)

The hosted verification / publishing service remains a separate Cloud product. The schema, client, and decoder helpers in this repository stay open.

### Phase 2 - The Decoding Standard (2026 H2)

- SEP draft - standardized Soroban event schema + registry verification spec, submitted to `stellar/stellar-protocol`
- `orbital codegen` - CLI + `orbital.config.ts` manifest that emits TypeScript types, typed event guards, and `useContractEvent<T>` hooks from the registry schema
- Semantic layer - event taxonomy (`swap.executed`, `loan.liquidated`, …) and entity labels, published as **open data**; the hosted read API that serves them is the operated product (see [Hosted ABI Registry](#what-orbital-monetizes-never-open-sourced) below)

### Phase 3 - Anchor Events (2027 H1)

- `@orbital-stellar/anchor-sdk` - typed client for SEP-24 / SEP-31 lifecycle events

### Worker layer (Phase 4 — unfrozen)

The worker layer (Part C) was unfrozen in writing by issue #1036 / the dated
2026-08-30 [`CHANGELOG.md`](../CHANGELOG.md) entry and is tracked in
[ROADMAP.md's Phase 4](../ROADMAP.md#phase-4--workers-entry-gate). It is split
down the same open-code / operated-service line as the rest of Orbital:

**MIT (open, in this repository):**

- `worker-core` — the `@orbital-stellar/worker-core` runtime package: the
  open-source standard, types, and execution surface that lets off-chain
  workers *trigger* on-chain settlement and other Orbital events.
- **The standard** — the event-worker spec, trigger/attestation envelope, and
  reference types. Published as open data / open spec, the canonical surface
  other tools emit against (mirrors the ABI Registry's open-standard model).
- **The vault contract** — `contracts/worker-vault`, the *only* contract with
  custodial authority. MIT-licensed, audited, and deployed by Orbital; workers
  call into it, they never parallel it. This is what makes the §C.2
  trigger-≠-custodian constraint (`ORBITAL_PRD.md` §C.2) true rather than
  aspirational.

**Operated service (closed, separate Cloud repository — never folded back):**

- **Backstop** — the Orbital-operated containment service that limits blast
  radius if a worker faults. Operated at scale; not open-sourced.
- **Hosted verification** — the Orbital-operated verification service that
  attests worker proofs/envelopes (the worker *standard* and *client* are MIT;
  only the hosted verification service is closed, exactly like the Hosted ABI
  Registry model above).

Per [`ROADMAP.md` Phase 4](../ROADMAP.md#phase-4--workers-entry-gate), the build
order is a hard constraint: the backstop (`W4`) lands last, only after the
no-custody property is demonstrated across `W0`–`W3`.

### Frozen - not scheduled while Phases 1–3 are open

These were previously listed as future MIT packages. They remain MIT-eligible in principle (the rule of thumb below still applies if they are ever unfrozen), but they are not on the active roadmap - see [ROADMAP.md's Frozen section](../ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven) for the rationale and the unfreeze procedure.

**Carve-out:** the **worker layer (Part C)** is **not** in this Frozen list. It
was unfrozen in writing (issue #1036 / the 2026-08-30 [`CHANGELOG.md`](../CHANGELOG.md)
entry) and is now tracked in [ROADMAP.md's Phase 4](../ROADMAP.md#phase-4--workers-entry-gate).
Payments SDK, auth/identity, x402, agent-sdk, intent compiler, shadow-fork
simulator, and analytics dashboards stay frozen.

- `@orbital-stellar/payments` - send, receive, path-payment, payroll-batch primitives *(frozen - see ROADMAP.md)*
- `@orbital-stellar/auth` - WebAuthn / passkey embedded wallet SDK *(frozen - see ROADMAP.md)*
- `@orbital-stellar/analytics` - client library + event-volume reference dashboards *(frozen - see ROADMAP.md)*
- `@orbital-stellar/x402` - Express / Next.js middleware for payment-gated API access *(frozen - see ROADMAP.md)*
- `@orbital-stellar/agent-sdk` - payment client for autonomous AI agents *(frozen - see ROADMAP.md)*
- Identity layer - passkey-based embedded wallets, federated Stellar addresses *(frozen - see ROADMAP.md)*
- Intent compiler - DSL + graph runtime *(frozen - see ROADMAP.md)*
- Shadow-fork simulator *(frozen - see ROADMAP.md)*
- Reference reactor contracts (Soroban Rust) *(frozen - see ROADMAP.md)*

Two items from the prior list are not addressed by the current roadmap at all (neither active nor frozen) - `@orbital-stellar/hooks` (`useAccount`, `useBalance`, `useTransaction`, `useOrderBook`) and the ZK-proof generation library (Noir / RiscZero circuits). They are paused pending a future roadmap decision.

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
| **Hosted ABI Registry** | The verification / publishing service operated by Orbital (the **schema** and **client** are MIT - only the hosted service is closed) |

**Rule of thumb for what lives there:** if the value comes from **operating** something at scale or **certifying** it, it's closed. If the value comes from the **code itself**, it's open.

---

## The architectural boundary

The public packages expose **interfaces**; the private repository ships **adapters** against those interfaces. The interfaces stay MIT; the adapters can be closed.

Examples of the boundary:

| Public interface (MIT) | Private adapter (Closed) |
|---|---|
| `CoreConfig.horizonUrl` | Orbital-operated mainnet Horizon node behind an authenticated endpoint |
| `CoreConfig.cursorStore` | Multi-region Postgres cursor store with consensus on dedup |
| `WebhookDelivery.retryQueue` | Managed Redis / Postgres queue with manual replay UI |
| `WebhookDelivery` event handlers (`webhook.failed`, `webhook.dropped`) | Hosted dead-letter explorer and forensics console |
| `EventEngine.subscribe(address, { filter })` | Hosted address-and-event-type RBAC scopes |

This split lets us ship enterprise features without forking `pulse-core`, and lets self-hosters keep parity with Cloud for the parts that matter (correctness, security, performance).

---

## Contributor guidance - will my PR be accepted?

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

### Frozen - not accepted while Phases 1–3 are open

- Intent DSL / graph compiler interfaces
- Shadow-fork simulator extensions
- Reactor contract reference library
- `@orbital-stellar/payments`, `@orbital-stellar/auth`, identity layer, `@orbital-stellar/x402`, `@orbital-stellar/agent-sdk`, `@orbital-stellar/analytics`

**Carve-out:** the **worker layer (Part C)** is *not* frozen — it was unfrozen
in writing (issue #1036 / the 2026-08-30 [`CHANGELOG.md`](../CHANGELOG.md)
entry) and lives in [ROADMAP.md's Phase 4](../ROADMAP.md#phase-4--workers-entry-gate).
PRs against the worker layer are reviewed per that phase's gates, not closed as
frozen.

These are frozen per [ROADMAP.md](../ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven), not merely deprioritized - PRs against them will be closed with a pointer to that section rather than reviewed.

If you are not sure where a PR falls, open an issue with the `policy-question` label before investing time. We will tell you in 48 hours.

---

## License commitment

- **All current packages** ship under MIT and will not be relicensed. Specifically, Orbital commits to **not** adopting source-available licenses (SSPL, BSL, Elastic License, Functional Source License, or successors) for any code that has shipped under MIT.
- **All future SDK packages** under the `@orbital-stellar/` namespace will ship under MIT.
- **Reference implementations, schemas, and specs** ship under MIT. This includes the event normalization format, the webhook delivery contract, and the Soroban ABI Registry schema.
- **The marketing and documentation site** (`apps/web/`) is MIT - you may fork and adapt it.

If Orbital is ever acquired or restructured, the MIT licenses already granted are irrevocable for the code that has shipped under them. The strongest guarantee a contributor can rely on is the public commit history under this license.

---

## What is not yet decided

These are honest uncertainties as of `v0.1.0`. They will be resolved in writing here when the decision is made.

| Question | Status |
|---|---|
| Will the Soroban ABI Registry **data** (schemas, taxonomy, labels) be a public good or a paid dataset? | The **data** (event taxonomy and entity labels) is published as **open data** under Creative Commons Zero (CC0 1.0) on every release, fetchable over plain HTTP (`/data/taxonomy.json`, `/data/labels.json`) with no JS SDK dependency. The **client** and **schema** are MIT. The **hosted read API** is currently planned as a free-tier public good, with a paid tier for high-volume integrators. Final structure TBD by Phase 2 close. |
| Will the intent compiler ship as runnable-locally OSS at maturity? | Frozen - not scheduled. See [ROADMAP.md's Frozen section](../ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven). Revisit only if unfrozen per that section's procedure. |
| Will the reactor-contract certification service be Orbital-operated or community-governed? | Frozen - not scheduled. See [ROADMAP.md's Frozen section](../ROADMAP.md#frozen--out-of-scope-until-the-core-thesis-is-proven). |

When these resolve, the row will be moved to §2 or §3 as appropriate.

---

## Changing this policy

This document is the public contract Orbital makes with its contributors and consumers. Material changes follow a public process:

1. A pull request to this file, with the rationale in the PR description.
2. A 14-day public comment window via GitHub Discussions.
3. Sign-off from the maintainer, recorded in the merged PR.

Changes that **remove items from §2 (MIT) or add items to §3 (Closed)** are subject to the constraint that already-shipped code under MIT remains MIT - see [License commitment](#license-commitment). New scope can be assigned to either column; existing scope cannot move from open to closed.

Editorial changes (typos, link updates, doc references) follow the normal PR flow without the comment window.

---

## Related documents

- [`LICENSE`](../LICENSE) - the MIT license text
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) - the technical map, including extension-point interfaces
- [`docs/proposal.md`](./proposal.md) - the SCF grant case
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) - the dev loop and PR process
- [`SECURITY.md`](../SECURITY.md) - vulnerability disclosure policy
- [`ROADMAP.md`](../ROADMAP.md) - multi-year phase plan
