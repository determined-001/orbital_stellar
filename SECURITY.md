# Security Policy

> Reporting, scope, threat model, and operational guidance for running
> Orbital safely. If you have found a vulnerability, jump straight to
> [Reporting a vulnerability](#reporting-a-vulnerability).

---

## Table of contents

- [Supported versions](#supported-versions)
- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Scope](#scope)
- [Threat model](#threat-model)
- [Vault audit gate (Phase 4 worker layer)](#vault-audit-gate-phase-4-worker-layer)
- [Secret rotation runbook](#secret-rotation-runbook)
- [Repository secret inventory](#repository-secret-inventory)
- [Dependency policy](#dependency-policy)
- [Best practices for consumers](#best-practices-for-consumers)
- [Disclosure policy](#disclosure-policy)

---

## Supported versions

| Version | Supported | Notes |
|---|---|---|
| `v0.1.x` | ✅ | Current release line. Security fixes will continue through Phase 1. |
| `main` | ✅ | Tracks the next release. Security fixes ship here first, then backport. |

Pre-release tags (`-alpha`, `-beta`, `-rc`) receive fixes only for critical vulnerabilities. Once `v1.0` ships (Phase 1), the [stability pledge in `STABILITY.md`](./STABILITY.md) will define a longer support window.

---

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private advisory system:

1. Go to the [**Security** tab](https://github.com/determined-001/orbital_stellar/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in: what you found, how to reproduce, the impact, and any suggested fix.

We will acknowledge your report within **72 hours** and aim to ship a fix within **14 days** for critical issues. You will be credited in the release notes unless you prefer otherwise.

---

## Scope

### In scope

- `packages/pulse-core` - SSE stream handling, event normalization, reconnection logic, watcher routing
- `packages/pulse-webhooks` - HMAC signing, delivery, SSRF protections, edge-runtime verification, timing-safe comparison
- `packages/pulse-notify` - React hook lifecycle, token forwarding, SSE parsing
- `apps/web/app/api/*` - the reference Next.js route handlers (note: rate-limit bypasses on the public demo are tracked here)
- Documentation in `docs/` and per-package READMEs that recommends an unsafe pattern

### Out of scope

- Vulnerabilities in third-party dependencies - report upstream; open a Dependabot advisory here if you want to track it
- Issues that require physical access to the server running Orbital
- Denial-of-service against the Stellar network itself (Horizon, Stellar RPC)
- Demo-site rate-limit bypass that does not impact other users (the marketing demo is intentionally sandboxed; abuse is bounded by Vercel's connection limits)
- Misconfiguration of self-hosted deployments - the SDKs ship safe defaults; we cannot defend you against deliberate misconfiguration

---

## Threat model

Adversaries, assets, and mitigations. Each scenario describes the failure mode, the mitigation in our codebase, and the detection signal. If a scenario below is not defended, it is a bug - file a private advisory.

### Webhook payload tampering

**Threat.** A network attacker modifies the body of a delivered webhook in transit, or replays a legitimate body at a later time.

**Mitigation.** Every delivery carries `x-orbital-signature` (HMAC-SHA256 over `${timestamp}.${body}`) and `x-orbital-timestamp`. Receivers verify with `verifyWebhook` (Node) or `verifyWebhookEdge` (Web Crypto), both of which use timing-safe comparison. Receivers should also reject signatures older than a small window (recommended: 5 minutes) to bound replay.

**Detection.** Verification failures should be logged with the IP and the failed signature so repeated failures surface as an attack pattern.

### SSRF via webhook target

**Threat.** A misconfigured or malicious operator points a `WebhookDelivery` at a loopback address, a private RFC 1918 IP, or a metadata service like `169.254.169.254` to exfiltrate cloud credentials.

**Mitigation.** `WebhookDelivery` validates the target URL before each request. Loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), multicast/reserved IPv4 ranges, and `.localhost` names are blocked. For hostname targets in the Node delivery path, every A and AAAA DNS answer is checked and the request's first hop is pinned to the checked address through a custom resolver; TLS still verifies the certificate against the original hostname. Redirects are not followed because redirect targets have not passed the same URL and DNS checks.

**Detection.** A `webhook.dropped` event is emitted when delivery is blocked. Surface this in your observability.

**Note on ASN blocking.** This package does *not* provide autonomous-system-number (ASN) blocking. A prior implementation accepted a `blockedAsns` config and resolved it via a per-validation network call to RIPE's RDAP `autnum` endpoint, but that endpoint takes an ASN, not a hostname, so the lookup always succeeded-empty and every URL was silently allowed (issue #1029). That control was removed; `UrlValidator` now throws if you pass `blockedAsns`, so a missing control fails loud rather than open. If you need ASN-based egress restrictions, implement them against a *cached local* ASN dataset in your own `urlValidator` - never a network call per validation, which is its own denial-of-service lever.

### Malformed SSE input

**Threat.** Horizon - or a man-in-the-middle proxy - emits a record with unexpected shape or missing fields, attempting to crash the engine or smuggle data.

**Mitigation.** Every field is `typeof`-checked before normalization. Malformed records are dropped with a `warn` log, not thrown - the stream stays up. The `raw` field on every normalized event preserves the original record for consumer-side audit.

**Detection.** Warn logs from the `[pulse-core] normalize()` prefix.

### HMAC secret leak

**Threat.** The webhook secret is committed to source control, logged in stdout, or exfiltrated via a downstream consumer's debug output.

**Mitigation.** The SDKs read the secret from the operator's config object - we never log it. Receivers using `verifyWebhook` / `verifyWebhookEdge` pass the secret as an argument; the verifiers do not log it on failure. Consumers are responsible for storing the secret in a secrets manager (Vault, AWS Secrets Manager, Vercel env, etc.), not in `.env` files committed to repos.

**Detection.** None directly inside Orbital. Use GitHub secret scanning and Dependabot secret-scan alerts at the repo level.

### Replay against an unrotated secret

**Threat.** A secret is suspected compromised. Without a rotation procedure, every signed delivery using the old secret remains forgeable.

**Mitigation.** [Secret rotation runbook](#secret-rotation-runbook) below. Receivers can be configured to accept both an old and new secret during a rotation window - the verifier returns success if either secret produces a matching signature.

**Detection.** None directly. Operator must trigger rotation on suspicion.

### Concurrent-retry resource exhaustion

**Threat.** A downstream endpoint becomes slow or unreachable. Without bounding, in-flight retries accumulate and consume unbounded memory.

**Mitigation.** `WebhookDelivery` enforces `maxConcurrentRetries` (default 100). When the cap is hit, the newest pending retry is evicted and emits `webhook.dropped`. Bounded queue depth means memory is bounded.

**Detection.** `webhook.dropped` event count over time. Route to your alerting.

### Demo rate-limit bypass (apps/web)

**Threat.** A user finds a way to circumvent the per-IP stream cap or the webhook-sample cooldown on the public marketing demo, exhausting Vercel resources.

**Mitigation.** Per-IP and per-session limits enforced in `apps/web/lib/demo-limits.ts`. Behind Vercel, the connection limit on the function tier provides a hard ceiling. The demo is intentionally sandboxed and not a production deployment.

**Detection.** Vercel function metrics. If the limit ceiling is reached, the marketing demo degrades; it does not propagate to consumers of the SDKs.

---

## No custodial contract (Phase 4 worker layer)

This section used to state an audit gate for a Soroban vault contract that
would have held user funds. **That contract was cut and the crate deleted**
(issues #1068, #1070, #1071, closed unbuilt) - see
[`docs/design/workers.md` §6](./docs/design/workers.md#the-vault-pattern-was-cut).

Orbital ships **no contract that takes custody of user funds.** The worker
layer's whole premise is that a worker calls a function anyone could have
called: `contracts/payroll`'s `disburse()` takes no caller authorization, so
the worst a caller controls is *when* an already-determined payment happens.
`withdraw()` takes no destination parameter at all.

The audit gate is therefore not "not yet met" - it does not apply, because
there is nothing custodial to audit. If a contract that holds user funds is
ever proposed again, this section must be restored **before** that contract is
written, not after.

## Secret rotation runbook

If you suspect a webhook secret has leaked, rotate immediately. The general procedure assumes you control both the sender (`WebhookDelivery`) and the receiver.

1. **Generate a new secret.** Use a cryptographically secure source - `openssl rand -hex 32`, AWS KMS, Vault, or an equivalent. Store it in your secrets manager alongside the existing one (do not replace yet).
2. **Update the receiver to accept both.** Modify the verification path to try the new secret first, fall back to the old. Both must use `timingSafeEqual` / constant-time comparison:
   ```ts
   const event =
     verifyWebhook(payload, sig, NEW_SECRET, ts) ??
     verifyWebhook(payload, sig, OLD_SECRET, ts);
   ```
3. **Deploy the receiver.** Confirm new and old secrets both succeed against test traffic.
4. **Update the sender.** Change `WebhookDelivery.config.secret` to the new value and redeploy.
5. **Verify.** Watch a delivery succeed with the new secret in your receiver's logs.
6. **Revoke the old secret.** After a grace window (recommended: 24 hours), remove `OLD_SECRET` from the receiver's verification fallback. Delete the old secret from your secrets manager.
7. **Audit.** If the leak source is unknown, audit deploy logs, environment-variable dumps, and any process where the secret may have appeared in plain text.

For very-high-volume systems, repeat steps 4–6 in stages by region or by webhook URL.

---

## Repository secret inventory

These are the secrets this repository itself handles - distinct from a consumer's webhook secret above. Each is listed with what it can do, where it is readable, and how it is rotated.

| Secret | Scope | Held in | Rotation |
|---|---|---|---|
| `DEMO_EMITTER_SECRET` | Signs `ping()` on the deployed `demo-emitter` contract, **testnet only**. Can call one no-arg function that emits an event; cannot move value. | Vercel project env (server runtime) | Generate a new testnet keypair, fund it, update the Vercel env var, redeploy. No coordination needed - the old key simply stops being used. |
| `SOROBAN_INVOKER_SECRET` | Signs registry publishes and integration-test invocations, **testnet only**. Can write to the registry contract under its own publisher address. | GitHub Actions repository secret | Generate and fund a new testnet keypair, update the repository secret, re-run the seeding workflow. Specs published under the old address stay valid; new ones use the new publisher. |
| `ORBITAL_REGISTRY_PUBLISHER_SECRET` | Alias used by the registry-loop integration test; same scope and handling as `SOROBAN_INVOKER_SECRET`. | GitHub Actions repository secret | As above. |
| `ORBITAL_OPERATOR_SECRET` | Signs worker submissions from `@orbital-stellar/worker-core` under the **operator's own** account. It pays its own fees and calls permissionless contract functions; it holds no authority over any subscriber's funds, and the submitter has no code path that accepts a second signer. | Operator deployment env (server runtime) | Generate and fund a new keypair, update the operator's env var, restart the worker. In-flight submissions signed by the old key are unaffected. |
| `NPM_TOKEN` | Publishes the `@orbital-stellar/*` packages. **The highest-value secret here** - a leak allows shipping arbitrary code to every consumer. | GitHub Actions repository secret, used only by `release.yml` | Revoke on npmjs.com immediately, issue a new automation token scoped to the `@orbital-stellar` org, update the repository secret. Then audit published versions for anything unexpected and deprecate as needed. |
| `UPSTASH_REDIS_REST_TOKEN` | Rate-limit counters for the demo endpoints. Read/write to one Upstash database holding no user data. | Vercel project env (server runtime) | Rotate in the Upstash console, update the Vercel env var, redeploy. |

**Rules that apply to all of them:**

- **No mainnet keys in demo or CI paths.** Both are testnet-only by construction: the demo invoker is reachable by anonymous visitors through a button, and CI secrets are readable by every workflow that runs. `assertRestrictedSecretNetwork` (in `@orbital-stellar/pulse-core`) enforces this at the point of use and refuses to sign when a demo or CI path is configured against mainnet.
- **No secret in a client bundle.** `scripts/assert-no-secrets-in-bundle.mjs` runs in CI after the web build with canary values for every secret above, and greps `apps/web/.next/static`. A hit fails the build. Adding a secret to `SECRET_ENV_VARS` in that script is what brings it under the gate - keep it in step with this table.
- **No secret in a log line or an error message.** Use `redactSecret()` if a value must appear in diagnostics; it keeps a four-character prefix for correlating with a rotation record and nothing usable. Errors name the *variable*, never the value.
- **Server-only imports.** Modules that read a secret start with `import "server-only"`, so a stray client import is a build error rather than a leak.

## Dependency policy

**Allowed licences.** Runtime dependencies must be MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, or CC0. A copyleft licence (GPL, AGPL, LGPL, SSPL) in a runtime dependency is not acceptable - every package here ships as MIT, and a copyleft transitive dependency would compromise that. Dev dependencies are held to the same list where practical; an exception must be recorded in the PR that introduces it.

**Automated audit.** `.github/workflows/security.yml` runs `pnpm audit` on every push and on a schedule. Overrides for advisories are declared in `pnpm-workspace.yaml` (never in `package.json` - a `pnpm.overrides` block there silently disables the workspace file's overrides) with a comment naming the advisory and the reason.

**Response window for a critical advisory:**

| Severity | Response |
|---|---|
| Critical | Patch or override within **24 hours**; if no fix exists, document the exposure in the advisory thread and remove the dependency if it is reachable from published code. |
| High | Within **7 days**. |
| Moderate / Low | Next regular dependency bump, at most **30 days**. |

Dependabot opens grouped dev-dependency updates; those are reviewed as ordinary PRs. A security-only update is not held back for a green Vercel preview.

---

## Best practices for consumers

A short checklist if you are building on top of Orbital.

### `pulse-core`

- **Always call `engine.stop()` in your shutdown path** - `process.on("SIGTERM", () => engine.stop())`. Leaking watchers leaks file descriptors at scale.
- **Subscribe with a `filter` predicate when possible** - reduces the event volume crossing the application boundary, smaller attack surface for consumer-side bugs.
- **Treat `event.raw` as untrusted** - it is preserved verbatim from Horizon for audit. If you parse it directly, apply your own validation.

### `pulse-webhooks`

- **Do not bypass the built-in URL checks** in production. `WebhookDelivery` does not expose an `allowPrivateNetworks` escape hatch; localhost and private-network endpoints should be tested with a separate development-only delivery path.
- **Enforce HTTPS at every layer where users supply a webhook URL.** The SDK enforces it; your registration UI should too.
- **Reject signatures older than 5 minutes** in your receiver - bound replay window:
  ```ts
  if (Date.now() - Number(timestamp) > 5 * 60 * 1000) {
    return res.sendStatus(401);
  }
  ```
- **Cap the receiver body size.** Use `express.raw({ type: "application/json", limit: "100kb" })` or equivalent. Stellar normalized events are kilobytes, not megabytes.
- **Route `webhook.failed` to a dead-letter store.** Otherwise terminal failures are lost silently.

### `pulse-notify`

- **Never ship a server-only secret to the browser.** The `token` config field is forwarded as a query parameter - issue per-user short-lived tokens from your backend, never your master API key.
- **Use `withCredentials: true` only with same-site `httpOnly` cookies** set by your backend - never store session tokens in `localStorage` for SSE auth.
- **Gate hooks behind `"use client"`** in Next.js App Router. SSR is not supported (the hooks use `EventSource`, which is browser-only).

---

## Disclosure policy

We follow coordinated disclosure. Once a fix is released, we publish a GitHub Security Advisory with full details. We ask reporters to wait until the advisory is public before writing about or sharing the vulnerability.

For high-severity issues we coordinate with downstream consumers (the named integrators in [`README.md`'s contributors section](./README.md#contributors)) before publishing the advisory, with a maximum 14-day window between fix release and public disclosure.

---

## Related documents

- [`docs/ARCHITECTURE.md` § 8 Trust boundaries and invariants](./docs/ARCHITECTURE.md#8-trust-boundaries-and-invariants)
- [`docs/open-source-policy.md`](./docs/open-source-policy.md) - license commitments
- [`docs/COOKBOOK.md` § 9 Route `webhook.failed` to a dead-letter queue](./docs/COOKBOOK.md#9-route-webhookfailed-to-a-dead-letter-queue)
- [`packages/pulse-webhooks/README.md`](./packages/pulse-webhooks/README.md) - full delivery contract
- [`docs/audits/`](./docs/audits/) - published external audit reports (none yet - see [Vault audit gate](#vault-audit-gate-phase-4-worker-layer))
