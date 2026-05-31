# ADR-003 — HMAC-SHA256 webhook signatures without explicit versioning

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-29 |
| **Affected** | `@orbital/pulse-webhooks` (`WebhookDelivery`, `verifyWebhook`, `verifyWebhookEdge`) |
| **Supersedes** | — |

---

## Context

Orbital webhooks need a tamper-evident signature so receivers can verify that a payload was produced by the holder of a shared secret and was not modified in transit. The chosen scheme must:

1. Be cheap to verify on every webhook delivery, including in edge runtimes (Cloudflare Workers, Vercel Edge, Deno) where Node's `crypto` is not available.
2. Survive replay attempts via a bounded timestamp window.
3. Not silently transmit unverifiable bytes that a receiver might accidentally trust.

The shape of the header is the first design lever — versioned (Stripe-style `t=<timestamp>,v1=<hex>`) or unversioned (Orbital-style: `x-orbital-signature: <hex>` plus a separate `x-orbital-timestamp: <ms>`).

---

## Decision

The webhook signature format is **unversioned**. Each delivery carries three headers:

- `x-orbital-signature` — hex-encoded HMAC-SHA256 over `${timestamp}.${body}`
- `x-orbital-timestamp` — Unix epoch milliseconds as a string
- `x-orbital-attempt` — `1`, `2`, … up to `retries`

The algorithm and the field-construction rule are fixed at HMAC-SHA256 over `${timestamp}.${body}`. There is no `v1=` prefix and no algorithm identifier inside any header.

---

## Rationale

### Why not Stripe-style versioning

Stripe's `Stripe-Signature: t=…,v1=…` format was designed to allow signature-algorithm rotation without breaking older receivers. The trade-offs Stripe accepts:

- Receivers must parse a structured header (split on `,`, then on `=`).
- The parser is a security-sensitive surface (CRLF injection, duplicate-key handling).
- Receivers must know which versions to trust and which to reject.

These costs are real, especially in edge runtimes where every additional dependency matters. For Orbital's `v0.1.0` surface, where we ship the receivers (`verifyWebhook`, `verifyWebhookEdge`) ourselves and consumers do not write their own header parsers, the rotation flexibility does not justify the receiver-side complexity.

### How Orbital handles algorithm change

If we ever need to rotate the algorithm (e.g., to SHA-512 or BLAKE2), we will introduce a new header — `x-orbital-signature-v2` — alongside the existing `x-orbital-signature`. During a deprecation window both will be sent; receivers can verify against whichever one they recognize. The current `verifyWebhook` and `verifyWebhookEdge` keep working unchanged on the `v1` header; new code adds a second verifier for the `v2` header.

This puts the cost of upgrade on the small set of people who change algorithm (us, once, with a major version bump) rather than on every receiver every time they verify a payload.

### Replay defense lives elsewhere

The unversioned format does not weaken replay defense. The `x-orbital-timestamp` is signed into the HMAC, and `SECURITY.md` documents the recommended receiver-side check: reject signatures whose timestamp is more than 5 minutes old. Replay protection does not depend on header versioning.

---

## Consequences

### Accepted

- Receivers cannot transparently negotiate a new algorithm. If we want to introduce SHA-512, every receiver must update to verify the new header.
- The header structure is locked at three fixed-name headers. Field renames are a breaking change.
- Future ADRs that add per-delivery features (e.g., scope tags, delivery IDs) need new headers, not new fields inside the signature header.

### Mitigated

- Algorithm rotation path is documented above — additive headers, not a modified signature format. A `v2` ADR will supersede this one when (if) that change is made.
- The verification surface stays small: `verifyWebhook` is 18 lines, `verifyWebhookEdge` is 41 lines. Both fail closed on any malformed input.

### Not affected

- Per-attempt headers (`x-orbital-attempt`) are orthogonal to signature scheme — they convey retry context, not signature material.
- SSRF and replay-window defenses are independent of signature format.

---

## Implementation

- Sender: [`packages/pulse-webhooks/src/index.ts`](../../packages/pulse-webhooks/src/index.ts) — `WebhookDelivery.sign()` and the `deliverToUrl` POST headers.
- Receiver (Node): [`packages/pulse-webhooks/src/index.ts`](../../packages/pulse-webhooks/src/index.ts) — `verifyWebhook`.
- Receiver (edge): [`packages/pulse-webhooks/src/edge.ts`](../../packages/pulse-webhooks/src/edge.ts) — `verifyWebhookEdge`.
- Delivery contract: [`packages/pulse-webhooks/README.md`](../../packages/pulse-webhooks/README.md#delivery-contract).
- Architecture deep-section: [`docs/ARCHITECTURE.md` § 6 Webhook delivery internals](../ARCHITECTURE.md#6-webhook-delivery-internals).

---

## Related

- [`SECURITY.md` § Threat model § Webhook payload tampering](../../SECURITY.md#webhook-payload-tampering)
- [`SECURITY.md` § Secret rotation runbook](../../SECURITY.md#secret-rotation-runbook)
- [`docs/COOKBOOK.md` § 7 Verify a webhook in a Cloudflare Worker](../COOKBOOK.md#7-verify-a-webhook-in-a-cloudflare-worker)
