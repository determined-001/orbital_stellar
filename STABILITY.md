# Stability pledge

## TL;DR

From `v1.0.0`, the public API of every `@orbital-stellar/*` package follows
strict [semver](https://semver.org/spec/v2.0.0.html). Breaking changes ship
only in majors. Deprecated surfaces get at least a 6-month window before
removal. Every breaking change has a documented migration path.

---

## What is covered

The public API surface of all four packages:

- **`@orbital-stellar/pulse-core`** — `EventEngine`, `Watcher`, the
  `NormalizedEvent` discriminated union and all per-event shapes,
  `CursorStore` and its reference adapters, lifecycle events
  (`engine.reconnecting`, `engine.reconnected`, `engine.rate_limited`,
  `engine.stopped`).
- **`@orbital-stellar/pulse-webhooks`** — `WebhookDelivery`, `verifyWebhook`,
  `verifyWebhookEdge`, `RetryQueue` and its reference adapters.
- **`@orbital-stellar/pulse-notify`** — all exported hooks.
- **`@orbital-stellar/abi-registry`** — client interfaces, the `decodedData`
  shape, the schema format, `RegistryPublisher`.

**Wire and data contracts are API.** This pledge is not limited to
TypeScript signatures. The following are all covered, and a change to any of
them is a breaking change even for a consumer who never imports our
TypeScript:

- The webhook header names — `x-orbital-signature`, `x-orbital-timestamp`,
  `x-orbital-attempt`
- The HMAC signing scheme
- Retry semantics
- The `NormalizedEvent` JSON shape on the wire
- The cursor format (see [`docs/cursor-format.md`](./docs/cursor-format.md))
- The registry schema format

## What is not covered

- Internal or `Unstable`-prefixed / experimental surfaces
- The `apps/web` reference composition — it is an example, not an API
- Explicitly-unspecified behavior (e.g. event ordering across distinct
  watchers)
- Type-level changes that affect only unsupported usage
- New packages before their own `1.0.0` — these are versioned `0.x` and may
  break in minors

## Version semantics

| Bump | Covers |
|---|---|
| **Patch** | Bug fixes, security fixes, docs, non-observable internal changes |
| **Minor** | New exports, new optional fields/params, new event types added to unions, deprecations with warnings |
| **Major** | Removal of surfaces deprecated ≥6 months prior, behavioral changes, dependency floor bumps — every break documented in the migration guide |

> **Footnote.** New `NormalizedEvent` variants may be added in minors.
> Consumers using `switch (event.type)` should keep a `default` branch that
> **ignores** unknown types. Exhaustive matching with no fallback is only
> safe within a major.

## Deprecation policy

1. A deprecation ships in a **minor**, with:
   - `@deprecated` JSDoc on the surface
   - A `CHANGELOG.md` entry naming the replacement
   - A one-time runtime warning where feasible
2. The deprecated surface works for **at least 6 months**.
3. It is never removed in the same major it was deprecated in.
4. Removal happens only in the next major, with before/after examples in the
   migration guide.

## Security exception

If a covered surface **is itself** the vulnerability, we may break it in a
patch. When this happens:

- The `CHANGELOG.md` entry's `### Security` section says so explicitly.
- A GitHub Security Advisory is published per [`SECURITY.md`](./SECURITY.md).
- Release notes include the smallest possible migration.

## Node / runtime support

- Each major documents its supported Node versions — currently **Node 20
  and 22**, matching CI.
- Dropping a Node version is a breaking change and ships only in a major.
- Edge-runtime support is pledged only for surfaces with an explicit Edge
  variant (`verifyWebhookEdge`).

## Closing rule

This document can only become **stricter** within a major. Loosening any
guarantee here is itself a breaking change and requires a major release plus
a `CHANGELOG.md` `### Changed` entry.
