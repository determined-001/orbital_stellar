# ADR-005 — Reference composition lives in `apps/web`, not `apps/server`

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-28 |
| **Affected** | Repository structure, `apps/web/app/api/*` route handlers, `apps/server` (removed) |
| **Supersedes** | The implicit architecture in earlier `PROGRESS.md` and strategy documents that named `apps/server` as the reference composition |

---

## Context

Orbital ships three SDK packages that are designed to be composed: `pulse-core` produces typed events, `pulse-webhooks` delivers them to HTTPS endpoints, and `pulse-notify` consumes them in React via an SSE backend. Anyone evaluating, integrating, or auditing the SDKs needs to see a runnable end-to-end composition somewhere in the repo. Without it, every newcomer reads three READMEs and assembles the integration mentally.

Until 2026-05-28, that runnable composition lived in `apps/server` — an Express application with a `WebhookRegistry`, an auth middleware, RFC 7807 error responses, pino structured logging, and an SSE endpoint. `apps/web` (the Next.js marketing site) consumed `apps/server` via a `NEXT_PUBLIC_SERVER_URL` env var.

The setup had four costs:

1. **Two processes to run** — `pnpm dev` against the marketing site only worked if you also ran `apps/server` on port 3000 and configured `NEXT_PUBLIC_SERVER_URL`.
2. **Two READMEs to maintain** — every change to the composition affected both apps and both README narratives.
3. **CORS, port collisions, and env-var coordination** — friction on every first-time setup.
4. **A second deployment target** — Vercel-hosted marketing site plus a separate place to run the Express server (Railway, Fly, a VPS).

Strategy memos described `apps/server` as a "worked example, not a production hosting story." The Cloud product (closed source per ADR-future, [`docs/open-source-policy.md`](../open-source-policy.md)) is the actual production answer. `apps/server`'s job was always to be a copy-paste reference, not a deployment target.

---

## Decision

The reference composition is consolidated into the Next.js app at `apps/web`. Specifically:

- `apps/web/app/api/events/[address]/route.ts` — SSE handler that subscribes a `Watcher` and streams events. Sandboxed for the public demo with limits in `apps/web/lib/demo-limits.ts`; strip the limits for production use.
- `apps/web/app/api/webhook-sample/route.ts` — HMAC-signed sample payload for the on-page webhook demo.
- `apps/web/lib/engine.ts` — lazy `globalThis`-scoped `EventEngine` singleton that survives Next.js HMR (see [ADR-future on the singleton pattern] if formalized).

`apps/server/` is deleted from the repository. Existing documentation, the SCF proposal, and the per-package READMEs now point at `apps/web/app/api/*` as the reference.

---

## Rationale

### One runtime

The reference composition is now a single Next.js application. `pnpm --filter orbital/web dev` runs the marketing site, the docs, and the demo backend in one process on one port. First-time contributors do not have to coordinate two processes or set environment variables before the page renders.

### Same demonstration surface

Every capability the Express version showed — SSE streaming, HMAC signing, per-IP rate limiting, graceful shutdown — is present in the Next.js route handlers, in idiomatic App Router form. The composition is smaller (about 200 lines vs. ~600), and the patterns translate directly to any Next.js backend.

### One deployment target

Self-hosters who want to run the reference deploy a single Next.js app to a single host. Vercel works out of the box for the marketing demo (with documented limitations on long-lived SSE in serverless functions); long-running deployments use `next start` on a Node host.

### Closer to where most consumers will land

Most teams adopting Orbital will reach for Next.js or another React-meta framework. A Next.js reference is closer to their target than an Express reference. Express adopters can still see the composition pattern in the Next.js routes and translate it (the SDK APIs are framework-agnostic).

### Strategy alignment

Per [`docs/open-source-policy.md`](../open-source-policy.md), the production answer for teams who don't want to operate event subscription themselves is Orbital Cloud (closed source, imports the packages from npm). Keeping a separate Express "reference server" alive in the public repo confused that boundary — newcomers asked whether `apps/server` was the production target. With the consolidation, there is no ambiguity: the SDKs are the protocol, `apps/web/app/api/*` is the runnable reference, and Cloud is the operated answer.

---

## Consequences

### Accepted

- **Express adopters lose a direct reference.** They must translate the Next.js route handlers to Express middleware. This is mechanical work — the SDK calls are identical — but it is a step they did not have before.
- **The "two ports during dev" pattern is gone.** Anyone whose mental model depended on a separate backend port (`localhost:3000` for server, `localhost:3001` for web) needs to adjust.
- **Some Express-specific patterns are no longer demonstrated** — pino structured logging, RFC 7807 problem responses, Express middleware composition. These were documented in `apps/server`; they are not documented in `apps/web` because they are not idiomatic Next.js.
- **Cold-start behaviour on Vercel** affects long-lived SSE streams. The reference handler documents this; production deployments must use `next start` on a Node host or accept periodic reconnects.

### Mitigated

- The future closed-source Orbital Cloud monorepo plan ([`docs/open-source-policy.md` § The architectural boundary](../open-source-policy.md#the-architectural-boundary)) imports the public packages directly from npm. The boundary the strategy memos described as "private repo imports public packages exactly the way `apps/server` does today" now reads "exactly the way `apps/web` imports them via workspace deps today" — semantically identical.
- Express adopters can find the equivalent composition in the per-package READMEs, which include Express receiver snippets where relevant (`packages/pulse-webhooks/README.md` includes the Express receiver pattern verbatim).

### Not affected

- The SDK public API is unchanged. No package code moved.
- The webhook signing scheme, verification surface, and React hook API are independent of the reference-composition location.
- The Cloud product's planned interface stays the same — it imports `@orbital/pulse-core` and `@orbital/pulse-webhooks`, layers a multi-tenant control plane on top, and ships that as a managed runtime.

---

## Implementation

- New routes: [`apps/web/app/api/events/[address]/route.ts`](../../apps/web/app/api/events/[address]/route.ts), [`apps/web/app/api/webhook-sample/route.ts`](../../apps/web/app/api/webhook-sample/route.ts).
- Singleton: [`apps/web/lib/engine.ts`](../../apps/web/lib/engine.ts).
- Limits: [`apps/web/lib/demo-limits.ts`](../../apps/web/lib/demo-limits.ts).
- Deletion: commits `81e6e75`, `d77cab1`, `567341f`, `622cfb6`, `0c686fc`, `94259bd` removed all of `apps/server/`.
- CI: `typecheck-server` job removed from `.github/workflows/ci.yml`; `web` paths filter expanded to also watch `packages/**`.
- Docs updated in the same arc: [`PROGRESS.md`](../../PROGRESS.md), [`README.md`](../../README.md), per-package READMEs, [`docs/proposal.md`](../proposal.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/COOKBOOK.md`](../COOKBOOK.md), `apps/web/content/getting-started/*`, `apps/web/content/api/pulse-notify.md`, `apps/web/content/guides/real-time-events.md`, `.github/ISSUE_TEMPLATE/bug_report.md`.

---

## Related

- [`docs/open-source-policy.md`](../open-source-policy.md) — the public/private boundary that this consolidation reinforces
- [`docs/ARCHITECTURE.md` § 9 Reference composition (`apps/web`)](../ARCHITECTURE.md#9-reference-composition-appsweb)
- [`docs/COOKBOOK.md` § 11 Stand up an SSE endpoint in Next.js](../COOKBOOK.md#11-stand-up-an-sse-endpoint-in-nextjs)
- [`apps/web/README.md`](../../apps/web/README.md) — demo limits and environment
