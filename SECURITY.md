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
- [Secret rotation runbook](#secret-rotation-runbook)
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

- `packages/pulse-core` — SSE stream handling, event normalization, reconnection logic, watcher routing
- `packages/pulse-webhooks` — HMAC signing, delivery, SSRF protections, edge-runtime verification, timing-safe comparison
- `packages/pulse-notify` — React hook lifecycle, token forwarding, SSE parsing
- `apps/web/app/api/*` — the reference Next.js route handlers (note: rate-limit bypasses on the public demo are tracked here)
- Documentation in `docs/` and per-package READMEs that recommends an unsafe pattern

### Out of scope

- Vulnerabilities in third-party dependencies — report upstream; open a Dependabot advisory here if you want to track it
- Issues that require physical access to the server running Orbital
- Denial-of-service against the Stellar network itself (Horizon, Stellar RPC)
- Demo-site rate-limit bypass that does not impact other users (the marketing demo is intentionally sandboxed; abuse is bounded by Vercel's connection limits)
- Misconfiguration of self-hosted deployments — the SDKs ship safe defaults; we cannot defend you against deliberate misconfiguration

---

## Threat model

Adversaries, assets, and mitigations. Each scenario describes the failure mode, the mitigation in our codebase, and the detection signal. If a scenario below is not defended, it is a bug — file a private advisory.

### Webhook payload tampering

**Threat.** A network attacker modifies the body of a delivered webhook in transit, or replays a legitimate body at a later time.

**Mitigation.** Every delivery carries `x-orbital-signature` (HMAC-SHA256 over `${timestamp}.${body}`) and `x-orbital-timestamp`. Receivers verify with `verifyWebhook` (Node) or `verifyWebhookEdge` (Web Crypto), both of which use timing-safe comparison. Receivers should also reject signatures older than a small window (recommended: 5 minutes) to bound replay.

**Detection.** Verification failures should be logged with the IP and the failed signature so repeated failures surface as an attack pattern.

### SSRF via webhook target

**Threat.** A misconfigured or malicious operator points a `WebhookDelivery` at a loopback address, a private RFC 1918 IP, or a metadata service like `169.254.169.254` to exfiltrate cloud credentials.

**Mitigation.** `WebhookDelivery` validates the target URL at construction time and re-validates against DNS resolution before each request. Loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and link-local (`169.254.0.0/16`) ranges are blocked unless `allowPrivateNetworks: true` is explicitly set. The DNS revalidation defends against DNS-rebinding attacks where an attacker-controlled hostname resolves to a public IP at validation time and a private IP at request time.

**Detection.** A `webhook.dropped` event is emitted when delivery is blocked. Surface this in your observability.

### Malformed SSE input

**Threat.** Horizon — or a man-in-the-middle proxy — emits a record with unexpected shape or missing fields, attempting to crash the engine or smuggle data.

**Mitigation.** Every field is `typeof`-checked before normalization. Malformed records are dropped with a `warn` log, not thrown — the stream stays up. The `raw` field on every normalized event preserves the original record for consumer-side audit.

**Detection.** Warn logs from the `[pulse-core] normalize()` prefix.

### HMAC secret leak

**Threat.** The webhook secret is committed to source control, logged in stdout, or exfiltrated via a downstream consumer's debug output.

**Mitigation.** The SDKs read the secret from the operator's config object — we never log it. Receivers using `verifyWebhook` / `verifyWebhookEdge` pass the secret as an argument; the verifiers do not log it on failure. Consumers are responsible for storing the secret in a secrets manager (Vault, AWS Secrets Manager, Vercel env, etc.), not in `.env` files committed to repos.

**Detection.** None directly inside Orbital. Use GitHub secret scanning and Dependabot secret-scan alerts at the repo level.

### Replay against an unrotated secret

**Threat.** A secret is suspected compromised. Without a rotation procedure, every signed delivery using the old secret remains forgeable.

**Mitigation.** [Secret rotation runbook](#secret-rotation-runbook) below. Receivers can be configured to accept both an old and new secret during a rotation window — the verifier returns success if either secret produces a matching signature.

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

## Secret rotation runbook

If you suspect a webhook secret has leaked, rotate immediately. The general procedure assumes you control both the sender (`WebhookDelivery`) and the receiver.

1. **Generate a new secret.** Use a cryptographically secure source — `openssl rand -hex 32`, AWS KMS, Vault, or an equivalent. Store it in your secrets manager alongside the existing one (do not replace yet).
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

## Best practices for consumers

A short checklist if you are building on top of Orbital.

### `pulse-core`

- **Always call `engine.stop()` in your shutdown path** — `process.on("SIGTERM", () => engine.stop())`. Leaking watchers leaks file descriptors at scale.
- **Subscribe with a `filter` predicate when possible** — reduces the event volume crossing the application boundary, smaller attack surface for consumer-side bugs.
- **Treat `event.raw` as untrusted** — it is preserved verbatim from Horizon for audit. If you parse it directly, apply your own validation.

### `pulse-webhooks`

- **Never deploy with `allowPrivateNetworks: true`** in production. It is a developer convenience for `localhost` testing only.
- **Enforce HTTPS at every layer where users supply a webhook URL.** The SDK enforces it; your registration UI should too.
- **Reject signatures older than 5 minutes** in your receiver — bound replay window:
  ```ts
  if (Date.now() - Number(timestamp) > 5 * 60 * 1000) {
    return res.sendStatus(401);
  }
  ```
- **Cap the receiver body size.** Use `express.raw({ type: "application/json", limit: "100kb" })` or equivalent. Stellar normalized events are kilobytes, not megabytes.
- **Route `webhook.failed` to a dead-letter store.** Otherwise terminal failures are lost silently.

### `pulse-notify`

- **Never ship a server-only secret to the browser.** The `token` config field is forwarded as a query parameter — issue per-user short-lived tokens from your backend, never your master API key.
- **Use `withCredentials: true` only with same-site `httpOnly` cookies** set by your backend — never store session tokens in `localStorage` for SSE auth.
- **Gate hooks behind `"use client"`** in Next.js App Router. SSR is not supported (the hooks use `EventSource`, which is browser-only).

---

## Disclosure policy

We follow coordinated disclosure. Once a fix is released, we publish a GitHub Security Advisory with full details. We ask reporters to wait until the advisory is public before writing about or sharing the vulnerability.

For high-severity issues we coordinate with downstream consumers (the named integrators in [`README.md`'s contributors section](./README.md#contributors)) before publishing the advisory, with a maximum 14-day window between fix release and public disclosure.

---

## Related documents

- [`docs/ARCHITECTURE.md` § 8 Trust boundaries and invariants](./docs/ARCHITECTURE.md#8-trust-boundaries-and-invariants)
- [`docs/open-source-policy.md`](./docs/open-source-policy.md) — license commitments
- [`docs/COOKBOOK.md` § 9 Route `webhook.failed` to a dead-letter queue](./docs/COOKBOOK.md#9-route-webhookfailed-to-a-dead-letter-queue)
- [`packages/pulse-webhooks/README.md`](./packages/pulse-webhooks/README.md) — full delivery contract
