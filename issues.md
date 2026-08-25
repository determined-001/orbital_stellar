# Orbital - Product Completion Backlog

45 issues covering everything between `main` today and Orbital being a complete
product: a deployed on-chain registry, a tagged `v1.0.0` with starter
boilerplates, a codegen CLI teams put in CI, a live semantic layer, a hosted
read API, and the anchor-event SDK.

Created on GitHub by [`scripts/create-product-issues.mjs`](./scripts/create-product-issues.mjs).

**Issue format.** Each issue is `### <number> <title>` followed by a metadata
block (`Labels`, `Milestone`, `Effort`, `Depends on`), then **Description**,
**Acceptance criteria** (checkboxes - the definition of done), **Implementation
notes** (ordered steps), and **Affected files**.

**Numbering.** Majors start at 8; majors 6 (CAP-67 unified ingestion) and 7
(SEP-48 attestation) are already open on the tracker.

**Effort → points.** Trivial 100 · Medium 150 · High 200.

---

## Why this backlog exists

Orbital has been paid the C band every wave since Wave 4. Not for lack of
effort - for one structural gap:

| Loop-gate leg | State | Evidence |
|---|---|---|
| Usable product surface, live | PASS | `@orbital-stellar/*` on npm at `v0.1.0`; `apps/web` deployed; three installable CLIs |
| On-chain depth, live | **FAIL** | `contracts/registry` and `contracts/demo-emitter` are code-complete with unit tests and a deploy script - never deployed. No `contracts/deployed.testnet.json`. `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` is `""`. The nightly integration job skips for want of `SOROBAN_CONTRACT_ID` / `SOROBAN_INVOKER_SECRET`. |

Merged contract code with an unrun deploy script is not depth. **Wave 8 exists
to close that leg and is worth more per hour than every other wave here
combined.** Waves 9-14 turn a closed loop into an A-band and eventually S-band
project.

| Wave | Theme | Issues | Roadmap phase | Band effect |
|---|---|---|---|---|
| 8 | Loop closure - live on-chain registry | 8.1-8.8 | Phase 2, Wave 2.0 | **C → B** |
| 9 | `v1.0.0` distribution | 9.1-9.7 | Phase 1, Waves 1.4-1.5 | holds B |
| 10 | `orbital codegen` completeness | 10.1-10.6 | Phase 2, Wave 2.2 | D2/D3 lift |
| 11 | Semantic layer | 11.1-11.6 | Phase 2, Wave 2.3 | the moat |
| 12 | Hosted registry | 12.1-12.6 | Phase 2, Wave 2.4 | **B → A** |
| 13 | Production hardening | 13.1-13.6 | cross-cutting | D8 lift |
| 14 | Anchor events | 14.1-14.4 | Phase 3 | A → S path |
| 15 | The SEP draft | 15.1-15.2 | Phase 2, Wave 2.1 | **A → S path** |

### Relationship to the issues already on the tracker

Issues `6.x` (CAP-67 unified ingestion) and `7.x` (SEP-48 attestation) are
already open or closed on the tracker. Nothing here duplicates them. Where scope
touches, ownership is stated explicitly inside the issue:

| This backlog | Existing issue | Boundary |
|---|---|---|
| 10.1 SEP-48 parsing | 7.9 (closed, #36) | 7.9 owns precedence order and its tests; 10.1 supplies the embedded-spec parsing that makes the canonical branch reachable |
| 11.1 taxonomy resolver | 7.7 (open) | 7.7 owns `taxonomy.schema.json`, naming rules and collision policy; 11.1 implements the engine that consumes it |
| 11.2 label schema | 7.7 / 7.8 (open) | 7.7 schemas taxonomy only; 11.2 adds the sibling label schema in the same directory |
| 11.3 submission automation | 7.8 (open) | 7.8 owns `docs/semantic-layer/submitting.md`; 11.3 automates the flow it documents |
| 8.3 on-chain seeding | 7.10 (open) | 7.10 produces attestation fixtures for the same four assets; 8.3 publishes their specs on chain |
| 9.5 CLI packaging | 7.6 (open) | 9.5 fixes the `bin` entries; 7.6 adds the `verify` subcommand that ships inside them |
| 12.3 verification pipeline | 7.5 (closed, #32) | 7.5 shipped `verifySchema`; 12.3 makes it a scheduled, enforced pipeline with stored verdicts |
| 12.6 long-range replay | 6.14 (open), 6.15 (closed) | 12.6 extends 6.15's e2e harness and reuses 6.14's cursor format |
| 15.1 SEP draft | 7.1-7.4, 7.7 | those are inputs to the draft; nothing on either tracker wrote or submitted the document |

**Contended files.** A shared file is not a duplicate, but three files are
edited by open CAP-67 issues *and* by this backlog. Sequencing matters more than
scope here:

| File | Open issues in flight | This backlog | Rule |
|---|---|---|---|
| `packages/pulse-core/src/EventEngine.ts` | 6.7, 6.11, 6.12, 6.13 | 12.6, 13.1, 13.2 | CAP-67 ingestion lands first. 12.6 plugs into 6.12's transport routing rather than adding a parallel source path; 13.1 and 13.2 wrap the engine, they do not restructure it |
| `packages/pulse-core/src/CursorStore.ts` | 6.14 | 12.6 | 6.14 defines the unified cursor format; 12.6 extends it. No third cursor shape |
| `packages/pulse-core/src/events.ts` | 6.8, 6.10 | 11.1, 14.1-14.3 | Both add members to the same union and both touch `types.exhaustive.test-d.ts`. Expect merge conflicts, not design conflicts - land CAP-67 members before anchor members |

Docs files (`docs/ARCHITECTURE.md`, `docs/COOKBOOK.md`) are shared by 6.16 / 6.17
and several issues here, but each writes a distinct section - no coordination
needed beyond normal review.

---

## Wave 8 - Loop closure: live on-chain registry

### 8.1 Deploy registry and demo-emitter to testnet

**Labels:** `type:ops` `area:contracts` `maintainer-only` `priority:critical`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Medium
**Depends on:** none

#### Description

`contracts/registry` (publish / resolve / per-version lookup, 7 unit tests) and
`contracts/demo-emitter` (`ping`, incrementing counter) are code complete on
`main`, and `contracts/deploy/deploy_testnet.sh` exists. Neither has ever been
deployed.

Every on-chain claim in the README, ROADMAP and proposal therefore resolves to
code that has never executed on a network. `OnChainAbiRegistryClient` is inert
because `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` is the empty string, so
`createDefaultAbiRegistryClient` silently skips the on-chain link in its
resolution chain.

#### Acceptance criteria

- [ ] `contracts/deployed.testnet.json` is committed with real contract IDs
- [ ] `ORBITAL_REGISTRY_TESTNET_CONTRACT_ID` and `ORBITAL_REGISTRY_PUBLISHER_ADDRESS` are non-empty
- [ ] Two testnet transaction hashes (one `registry.publish`, one `demo-emitter.ping`) are in the PR body
- [ ] Both contract IDs resolve on stellar.expert
- [ ] `contracts/README.md` has a Deployments table linking each ID

#### Implementation notes

1. Fund a testnet account via Friendbot; keep the secret out of the repo.
2. Run `contracts/deploy/deploy_testnet.sh` for both contracts; capture WASM
   hash and contract ID for each.
3. Write `contracts/deployed.testnet.json` with, per contract: `name`,
   `contractId`, `wasmHash`, `network`, `deployedLedger`, `deployerAddress`,
   and the git SHA of the source that produced the WASM.
4. Populate the two constants from that file - the constants module is the
   single source consumers read.
5. Invoke each contract once from the CLI and record the transaction hashes.

#### Affected files

- `contracts/deployed.testnet.json` (new)
- `contracts/deploy/deploy_testnet.sh`
- `packages/abi-registry/src/registryConstants.ts`
- `contracts/README.md`

---

### 8.2 Wire SOROBAN_CONTRACT_ID and SOROBAN_INVOKER_SECRET repo secrets

**Labels:** `type:ops` `area:contracts` `maintainer-only`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Trivial
**Depends on:** 8.1

#### Description

`.github/workflows/integration.yml` runs the nightly Soroban suite, and
`packages/pulse-core/test/integration/soroban.test.ts` skips itself when
`SOROBAN_CONTRACT_ID` or `SOROBAN_INVOKER_SECRET` are unset. Both have always
been unset, so the job has been green-because-skipped since it was added.

A permanently-skipped integration job is worse than no job: it reads as passing
coverage on the dashboard while asserting nothing.

#### Acceptance criteria

- [ ] A nightly run executes real testnet invocations
- [ ] A run on `main` with a missing secret **fails** rather than skipping, with a message naming the missing variable
- [ ] The resolved contract ID is printed in the run log; no secret is ever printed
- [ ] `SECURITY.md` documents both secrets and their rotation policy

#### Implementation notes

1. Add both secrets at repository level; the invoker key must be testnet-only.
2. Split the skip path: skip is acceptable on forks and PRs, never on `main`.
3. Add an echo step for the contract ID so runs are auditable after the fact.

#### Affected files

- `.github/workflows/integration.yml`
- `packages/pulse-core/test/integration/soroban.test.ts`
- `SECURITY.md`

---

### 8.3 Seed the registry with the four bundled well-known specs

**Labels:** `type:feature` `area:abi-registry`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Medium
**Depends on:** 8.1

#### Description

`packages/abi-registry/scripts/seed-well-known.ts` is written and tested against
a mock, and `packages/abi-registry/src/wellKnown.ts` bundles specs for USDC,
EURC, AQUA and the native XLM SAC wrapper.

Until those specs exist on chain under Orbital's publisher key, the bundle is a
local fallback rather than a registry, `OnChainAbiRegistryClient` resolves
nothing, and "canonical registry" describes a JSON file inside a package.

#### Acceptance criteria

- [ ] All four specs resolve from the live registry contract at version `1.0.0`
- [ ] Re-running the seed script is a no-op, not a failure
- [ ] `--dry-run` prints the exact `publish` arguments per spec without writing
- [ ] `contracts/deployed.testnet.json` records the `spec_hash` per asset under `seededSpecs`
- [ ] An integration test resolves each spec through the chain (not the bundle) and asserts the hash matches

#### Implementation notes

1. Run the seed script against the deployed registry.
2. Make it idempotent by detecting an existing `(contract_id, version)` before
   publishing - the contract rejects republishing the same version.
3. Add the `--dry-run` flag.
4. Add the chain-resolution test to the nightly integration job.
5. Open issue 7.10 produces unsigned *attestation documents* for these same four
   assets as schema fixtures. Different artifact, same contracts - reuse
   `wellKnown.ts` as the shared source so the on-chain spec and the attestation
   fixture cannot describe different things.

#### Affected files

- `packages/abi-registry/scripts/seed-well-known.ts`
- `packages/abi-registry/src/wellKnown.ts`
- `packages/abi-registry/src/OnChainRegistryPublisher.ts`
- `contracts/deployed.testnet.json`

---

### 8.4 End-to-end test: publish, subscribe, decodedData from the live contract

**Labels:** `type:test` `area:pulse-core`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** High
**Depends on:** 8.1, 8.3

#### Description

`decodedData` on `contract.emitted` is the payoff of the registry design: a raw
Soroban event arrives, the registry resolves its spec, and the consumer gets
typed fields instead of XDR.

That path has only ever been exercised against bundled specs and recorded
fixtures. Nothing proves it works against a contract whose spec was published on
chain minutes earlier.

#### Acceptance criteria

- [ ] One test run publishes a spec, subscribes, invokes `demo-emitter.ping`, and receives a `contract.emitted` with populated `decodedData`
- [ ] The test asserts resolution came from the on-chain link, not the bundle or the LRU cache
- [ ] An unresolvable contract ID fails with a message pointing at issue 8.1, not a generic RPC error
- [ ] The test runs nightly with a 5-minute timeout

#### Implementation notes

1. Add `packages/pulse-core/test/integration/registry-loop.test.ts` covering the
   full cycle in a single run.
2. Clear the cache before the run and assert a chain read occurred.
3. Handle testnet reset explicitly - it is the most likely failure and the most
   confusing one to debug from a stack trace.

#### Affected files

- `packages/pulse-core/test/integration/registry-loop.test.ts` (new)
- `packages/abi-registry/src/OnChainAbiRegistryClient.ts`
- `packages/abi-registry/src/createDefaultAbiRegistryClient.ts`
- `.github/workflows/integration.yml`

---

### 8.5 Unblock the Fire test event button on /demo/contracts

**Labels:** `type:feature` `area:apps-web`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Medium
**Depends on:** 8.1

#### Description

`apps/web/lib/fireDemoEvent.ts` and the button on `apps/web/app/demo/contracts`
are code complete and reference `SOROBAN_CONTRACT_ID`. Without a deployment the
button cannot do anything real.

A demo button that cannot fire is the exact pattern that costs bands: live
surface wired to nothing. It must work against the real contract or not ship.

#### Acceptance criteria

- [ ] Clicking the button on the deployed site submits a real testnet transaction
- [ ] The decoded event appears in the stream below it within one ledger
- [ ] The real transaction hash is shown, linked to stellar.expert
- [ ] The invoker secret never reaches the client bundle, asserted by a test over built output
- [ ] The route is rate limited (default 1 fire / 10s per IP)
- [ ] With the contract ID env var missing, the button renders disabled with "demo contract not configured" - never a fake success

#### Implementation notes

1. Point `fireDemoEvent.ts` at the deployed `demo-emitter` ID from
   `contracts/deployed.testnet.json`.
2. Keep signing server-side only.
3. Rate limit so a public demo cannot drain the funded account.

#### Affected files

- `apps/web/lib/fireDemoEvent.ts`
- `apps/web/app/demo/contracts/`
- `apps/web/app/api/demo/`

---

### 8.6 Run AutoPublishIndexer against the live registry

**Labels:** `type:feature` `area:orbital-indexer`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Medium
**Depends on:** 8.1

#### Description

`packages/orbital-indexer/src/AutoPublishIndexer.ts` auto-discovers an unknown
`contractId`, publishes its spec under Orbital's key, and caches the result,
with in-flight dedupe and backoff for undiscoverable contracts.

All of that is currently proven only against test doubles. The publish path has
never signed a real transaction, so its failure modes - insufficient fee,
sequence collision, republish rejection, rate limit - are unproven.

#### Acceptance criteria

- [ ] An integration test files a real spec on testnet for a genuinely unknown contract
- [ ] Two concurrent resolutions of the same unknown contract produce exactly one publish transaction
- [ ] Republish rejection is handled as success-with-existing, not as an error
- [ ] Sequence-number collision with the seed script's key is handled and tested
- [ ] Every publish emits a structured log line: contract ID, version, spec hash, tx hash

#### Implementation notes

1. Add `packages/orbital-indexer/test/integration/autopublish.test.ts`.
2. Assert dedupe by counting transactions, not by counting calls.
3. Treat the contract's duplicate-version rejection as the expected path on a
   re-run, not an exception.

#### Affected files

- `packages/orbital-indexer/src/AutoPublishIndexer.ts`
- `packages/orbital-indexer/test/integration/autopublish.test.ts` (new)

---

### 8.7 Deployment provenance: verify committed IDs match built WASM

**Labels:** `type:security` `area:contracts`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** Medium
**Depends on:** 8.1

#### Description

`contracts/deployed.testnet.json` becomes the trust anchor for the whole
registry: consumers resolve specs through the contract ID it names.

Nothing currently prevents that file from drifting from the source in
`contracts/registry`. A contract deployed from an unreviewed local build would
be indistinguishable from one built off `main`.

#### Acceptance criteria

- [ ] CI builds the contracts reproducibly using the pinned toolchain and compares the WASM hash to `wasmHash` in `contracts/deployed.testnet.json`
- [ ] A mismatch fails the job with a diff of expected vs actual
- [ ] The deployed WASM hash is fetched from the network and asserted equal to the locally built hash
- [ ] Changing contract source without redeploying turns the job red
- [ ] `contracts/README.md` documents the reproducible-build procedure

#### Implementation notes

1. Add the job to `.github/workflows/contracts.yml`.
2. Pin the toolchain from `contracts/rust-toolchain.toml` so the build is
   byte-reproducible across runners.

#### Affected files

- `.github/workflows/contracts.yml`
- `contracts/deployed.testnet.json`
- `contracts/rust-toolchain.toml`
- `contracts/README.md`

---

### 8.8 Registry contract: paginate version listing

**Labels:** `type:feature` `area:contracts`
**Milestone:** Wave 2.0 - Loop closure: live on-chain registry
**Effort:** High
**Depends on:** 8.1

#### Description

The registry contract lists versions oldest-first and tracks `latest`, scoped
per publisher (`contracts/registry/src/lib.rs`, snapshot tests in
`contracts/registry/src/test.rs`).

The version-list read is unbounded. At the Phase 2 gate target of 25+ registered
contracts - and far worse at ecosystem scale - an unbounded list read risks
exceeding the resource budget of a single Soroban invocation, with no way to
page.

#### Acceptance criteria

- [ ] `list_versions(contract_id, publisher, start, limit)` exists with a documented maximum `limit`
- [ ] The existing unpaged accessor is capped and returns an explicit truncation marker rather than silently dropping rows
- [ ] Unit tests cover: empty set, exactly `limit`, `limit + 1`, and a start cursor past the end
- [ ] Resource cost of a full-page read is recorded in the test snapshots so regressions show up in diffs
- [ ] `OnChainAbiRegistryClient` pages transparently

#### Implementation notes

1. Add the paged accessor and keep the old one for backward compatibility.
2. Redeploy following 8.1's procedure and update
   `contracts/deployed.testnet.json`.

#### Affected files

- `contracts/registry/src/lib.rs`
- `contracts/registry/src/test.rs`
- `packages/abi-registry/src/OnChainAbiRegistryClient.ts`

---

## Wave 9 - v1.0.0 distribution

### 9.1 orbital-next-starter boilerplate

**Labels:** `type:feature` `area:starters`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** High
**Depends on:** 8.1

#### Description

ROADMAP Wave 1.5 names three starters and `apps/web/app/starters` already
advertises them. None exist.

The path from "read the docs" to "typed Stellar events in my app" is currently:
install four packages, wire an engine, discover the hooks, guess at cursor
configuration. Every step is a drop-off point.

#### Acceptance criteria

- [ ] A stranger can clone, set two env vars, run `pnpm dev`, and see live typed Stellar events
- [ ] A contract page shows `decodedData` resolved through the live registry against the deployed `demo-emitter`
- [ ] `.env.example` documents every required variable, and a missing one fails startup with a readable error
- [ ] README has a one-command quickstart and a screenshot
- [ ] CI installs, typechecks and builds the starter

#### Implementation notes

1. Next.js App Router; `@orbital-stellar/pulse-core` server-side with a
   `FileCursorStore`, `@orbital-stellar/pulse-notify` hooks client-side.
2. Decide in the PR whether starters live in `examples/` here or as template
   repos, and apply the same choice to 9.2 and 9.3.

#### Affected files

- `examples/next-starter/` (new)
- `apps/web/app/starters/`

---

### 9.2 orbital-express-starter boilerplate

**Labels:** `type:feature` `area:starters`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** Medium
**Depends on:** 8.1

#### Description

The backend story - ingest, persist a cursor, deliver signed webhooks - is
Orbital's strongest production use case and has no runnable reference.
`docs/COOKBOOK.md` describes the composition in prose, and prose does not
compile.

#### Acceptance criteria

- [ ] `docker compose up && pnpm start` ingests events and delivers HMAC-signed webhooks
- [ ] Restarting the service resumes from the persisted cursor with no gaps, proven by a test
- [ ] A receiver endpoint demonstrates `verifyWebhook` and rejects a tampered payload, asserted by a test
- [ ] SIGTERM/SIGINT calls `engine.stop()` and flushes the cursor, asserted by a test
- [ ] README includes the resume-after-restart walkthrough

#### Implementation notes

1. Express or Fastify - pick one and justify in the PR.
2. `PostgresCursorStore` + `PostgresRetryQueue` with a `docker-compose.yml`, and
   a `MemoryCursorStore` fallback for zero-setup runs.

#### Affected files

- `examples/express-starter/` (new)
- `packages/pulse-webhooks/src/signing.ts`
- `packages/pulse-core/src/PostgresCursorStore.ts`

---

### 9.3 orbital-anchor-starter boilerplate

**Labels:** `type:feature` `area:starters`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** High
**Depends on:** 9.2

#### Description

The anchor starter is the bridge to Phase 3 and the strongest signal to the
regulated-money segment: audit-grade, replay-safe event capture.

Anchors need at-least-once delivery with an audit trail, which is a specific
composition of cursor, retry queue and dead-letter store that nobody will
assemble correctly from API docs alone.

#### Acceptance criteria

- [ ] The service captures payment and trustline events for a set of anchor distribution accounts into an append-only audit log
- [ ] `replay --from <cursor>` rebuilds the audit log byte-identically
- [ ] Audit records carry ledger, tx hash, operation index, memo, asset and both parties
- [ ] The delivery guarantee is documented honestly as at-least-once with idempotency keys, not exactly-once
- [ ] The recipe is linked from `docs/COOKBOOK.md`

#### Implementation notes

1. Compose `CursorStore` + `RetryQueue` + `DeadLetterStore`.
2. State the caveats in the README rather than implying stronger guarantees than
   the composition provides.

#### Affected files

- `examples/anchor-starter/` (new)
- `packages/pulse-webhooks/src/DeadLetterStore.ts`
- `docs/COOKBOOK.md`

---

### 9.4 Generate raw Horizon types from the OpenAPI description

**Labels:** `type:feature` `area:pulse-core`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** High
**Depends on:** none

#### Description

The last unchecked box in ROADMAP Wave 1.4. `packages/pulse-core/src/raw-horizon.ts`
carries hand-written types for Horizon response shapes.

Hand-written raw types drift silently whenever Horizon changes a field, and the
drift surfaces as a runtime `undefined` inside normalization rather than as a
type error.

#### Acceptance criteria

- [ ] A generator script emits TypeScript types from Horizon's OpenAPI description into a file marked do-not-edit
- [ ] `raw-horizon.ts` re-exports the generated types and the public API surface is unchanged
- [ ] `pnpm test:types` stays green
- [ ] CI regenerates and fails if the committed output differs
- [ ] The source description URL and revision are pinned in the script header
- [ ] `CONTRIBUTING.md` documents the regeneration command

#### Implementation notes

1. Add `scripts/generate-horizon-types.mjs` following the conventions of the
   existing `scripts/*.mjs`.
2. The CI drift check is the point of the issue - it converts upstream change
   into a red build instead of a production bug.

#### Affected files

- `scripts/generate-horizon-types.mjs` (new)
- `packages/pulse-core/src/raw-horizon.ts`
- `.github/workflows/ci.yml`
- `CONTRIBUTING.md`

---

### 9.5 Fix and test the published CLI entry points

**Labels:** `type:bug` `type:dx` `area:abi-registry`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** Medium
**Depends on:** none

#### Description

Three packages declare `bin` entries (`packages/pulse-core`,
`packages/pulse-webhooks`, `packages/abi-registry`). The CLI is the primary live
surface for users who never touch the web app.

The published binaries have not been verified end to end from a clean install,
and a broken `bin` has shipped before. A CLI that fails on `npx` is a broken
front door on the most-linked install path.

#### Acceptance criteria

- [ ] Every declared binary runs from a packed tarball installed into a temp directory
- [ ] Each binary supports `--help` and `--version`, both asserted in CI
- [ ] Shebangs, `files` inclusion, executable bits and ESM/CJS resolution are correct for each
- [ ] Every command has a worked example in `docs/COOKBOOK.md`

#### Implementation notes

1. Reproduce first from a directory outside the repo against the published
   tarball - the bug class only appears outside the workspace.
2. Add a `pnpm pack` smoke job to CI so it cannot regress.
3. Open issue 7.6 adds an `abi-registry verify` subcommand. This issue fixes the
   binaries that subcommand ships inside - land the packaging fix first so 7.6
   is not debugging a broken `bin` entry, and let 7.6 own its own COOKBOOK entry.

#### Affected files

- `packages/*/package.json` (`bin`, `files`)
- `packages/pulse-webhooks/src/cli.ts`
- `packages/abi-registry/src/` (CLI entry)
- `.github/workflows/ci.yml`

---

### 9.6 Cut v1.0.0

**Labels:** `type:ops` `maintainer-only`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** Medium
**Depends on:** 8.4, 9.1, 9.2, 9.3, 9.5

#### Description

Phase 1's release gate: `pnpm publish -r --filter "./packages/*"` at
`version: "1.0.0"`, `STABILITY.md` merged (done), Soroban e2e green (8.4).

Packages sit at `0.1.0`. Under `STABILITY.md`'s own semver contract, `0.x`
promises nothing - so the stability pledge is currently unenforceable by the
version number it is written against.

#### Acceptance criteria

- [ ] Every published package is at `1.0.0` with consistent inter-package dependency ranges
- [ ] `CHANGELOG.md` has an entry with Added / Changed / Fixed / Security / Impact covering everything since `0.1.0`
- [ ] `npm install @orbital-stellar/pulse-core@1.0.0` works from a clean cache
- [ ] The `v1.0.0` tag has release notes naming the stability pledge, the deprecation window, and the deployed contract IDs
- [ ] `README.md` badges and install snippets show `1.0.0`

#### Implementation notes

1. Verify `NPM_TOKEN` is configured for `.github/workflows/release.yml` and
   dry-run the publish before tagging.
2. Publish, then verify from a clean cache before writing the release notes.

#### Affected files

- `packages/*/package.json`
- `CHANGELOG.md`
- `.github/workflows/release.yml`
- `README.md`

---

### 9.7 Migration guide 0.1.0 to 1.0.0

**Labels:** `type:docs` `good-first-issue`
**Milestone:** Wave 1.5 - v1.0.0 distribution
**Effort:** Trivial
**Depends on:** 9.6

#### Description

`STABILITY.md` commits to a 6-month deprecation window and a documented
breaking-change policy. Existing `0.1.0` installs need to know exactly what
changed and what to edit; "read the changelog" is not a migration path.

#### Acceptance criteria

- [ ] `docs/migration/0.1-to-1.0.md` lists every breaking change with a before/after code block
- [ ] Source-compatible changes are stated explicitly as "nothing to do" rather than left to inference
- [ ] The new registry configuration surface from Wave 8 is covered
- [ ] The guide is linked from `README.md`, `CHANGELOG.md` and `STABILITY.md`

#### Implementation notes

1. Derive the list from the `CHANGELOG.md` entry written in 9.6 - do not
   duplicate its content, link to it.

#### Affected files

- `docs/migration/0.1-to-1.0.md` (new)
- `README.md`
- `CHANGELOG.md`
- `STABILITY.md`

---

## Wave 10 - orbital codegen completeness

### 10.1 Consume SEP-48 embedded event specs natively

**Labels:** `type:feature` `area:abi-registry` `needs-design`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** High
**Depends on:** none

#### Description

[SEP-48](https://github.com/orgs/stellar/discussions/1724) standardizes event
schemas inside the contract spec via `#[contractevent]`. ROADMAP Wave 2.2 is
explicit: an embedded SEP-48 spec is the canonical source, registry attestation
is the fallback for pre-SEP-48 contracts.

Issue 7.9 (closed, PR #36) already pinned that precedence *order* with tests
against `ChainedAbiRegistryClient`. What is still missing is the parsing leg:
nothing recognizes an embedded `#[contractevent]` entry in the first place, so
the canonical branch of the precedence chain can never be taken by a real
contract, and consumers cannot see which source answered.

#### Acceptance criteria

- [ ] `parseContractSpec` / `xdrToSpec` recognize embedded `#[contractevent]` entries and expose them as event specs
- [ ] The precedence order pinned by 7.9 still holds with real embedded specs flowing through it - 7.9's tests stay green, extended with a non-synthetic case
- [ ] Results carry `specSource` (`sep48` | `registry` | `wellKnown` | `discovery`) so consumers can display provenance
- [ ] An embedded spec disagreeing with a registry attestation emits a warning naming both hashes, with a test

#### Implementation notes

1. Do not re-implement precedence - 7.9 owns the order and its tests. This issue
   supplies the input that makes the `sep48` branch reachable.
2. Extend, never rewrite, `packages/abi-registry/test/` precedence coverage.

#### Affected files

- `packages/abi-registry/src/spec.ts`
- `packages/abi-registry/src/discovery/`
- `packages/abi-registry/src/ChainedAbiRegistryClient.ts`
- `packages/abi-registry/src/createDefaultAbiRegistryClient.ts`

---

### 10.2 Generate typed event guards from a resolved spec

**Labels:** `type:feature` `type:dx` `area:abi-registry`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** Medium
**Depends on:** none

#### Description

`packages/pulse-core/src/eventTypeGuard.ts` provides hand-written narrowing for
the built-in taxonomy; `packages/abi-registry/src/generate.ts` is the codegen
foundation.

Contract events get types but no narrowing helpers, so consumers hand-write
`if (event.topic === ...)` checks the compiler cannot verify - exactly the bug
class the typed-event thesis exists to eliminate.

#### Acceptance criteria

- [ ] Codegen emits an `isXxxEvent(e): e is XxxEvent` guard per event, alongside the type and Zod schema
- [ ] Codegen emits a discriminated union of a contract's events plus an exhaustive `switch` helper
- [ ] Generated output includes a `.test-d.ts` that fails to compile when an event is added to the spec but not handled
- [ ] Each guard validates at runtime through its Zod schema, not by shape-guessing

#### Implementation notes

1. Mirror the existing exhaustiveness pattern in
   `packages/pulse-core/test/types.exhaustive.test-d.ts`.

#### Affected files

- `packages/abi-registry/src/generate.ts`
- `packages/pulse-core/src/eventTypeGuard.ts`

---

### 10.3 useContractEvent hook generated from the registry schema

**Labels:** `type:feature` `area:pulse-notify`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** Medium
**Depends on:** none

#### Description

`packages/pulse-notify` ships `useStellarEvent`, `useStellarPayment`,
`useStellarActivity`, `useContractState` and Suspense variants, but no hook
typed by a *specific contract's* schema.

React hooks over registry-typed contract events is the differentiation against
`stellar contract bindings typescript`, which emits raw types and nothing else.

#### Acceptance criteria

- [ ] `useContractEvent<T>({ contractId, event, filter })` returns validated, typed events
- [ ] Codegen emits contract-specific wrappers (e.g. `useSwapExecuted()`) bound to the generated types
- [ ] One subscription exists per `(contractId, event)` regardless of hook-instance count, asserted by test
- [ ] Subscription count returns to zero after unmount, asserted by test
- [ ] A runnable snippet is in `docs/COOKBOOK.md`

#### Implementation notes

1. Reuse `packages/pulse-notify/src/connectionPool.ts` rather than opening a
   socket per hook.

#### Affected files

- `packages/pulse-notify/src/` (new hook)
- `packages/pulse-notify/src/connectionPool.ts`
- `packages/abi-registry/src/generate.ts`
- `docs/COOKBOOK.md`

---

### 10.4 orbital.config.ts contract manifest

**Labels:** `type:feature` `type:dx` `area:abi-registry`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** Medium
**Depends on:** none

#### Description

ROADMAP Wave 2.2 requires regeneration to be one CI command. Today
`orbital typegen <contractId>` is per-contract and per-invocation, so a project
tracking eight contracts has eight commands and no record of what it generated
or from which registry.

#### Acceptance criteria

- [ ] `orbital.config.ts` exports a typed `defineConfig({ contracts, network, registry, outDir })`
- [ ] `orbital codegen` regenerates every contract in the manifest into `outDir`
- [ ] `orbital codegen --check` regenerates into a temp dir and exits non-zero on drift
- [ ] `orbital.lock.json` pins the resolved spec hash per contract
- [ ] An invalid config fails with an error naming the offending field

#### Implementation notes

1. `--check` is the command starters and consumer CI will run; design its output
   for a CI log, not a terminal.

#### Affected files

- `packages/abi-registry/src/` (config loader, `codegen` command)
- `packages/abi-registry/src/generate.ts`

---

### 10.5 Codegen watch mode

**Labels:** `type:dx` `area:abi-registry` `good-first-issue`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** Trivial
**Depends on:** 10.4

#### Description

ROADMAP Wave 2.2 lists watch mode as a deliverable. During contract development
the spec changes constantly and re-running codegen by hand breaks flow.

#### Acceptance criteria

- [ ] `orbital codegen --watch` polls the registry on a configurable interval (default 15s)
- [ ] Only contracts whose spec hash changed are regenerated, per `orbital.lock.json`
- [ ] Bursts are debounced and each regeneration logs one line with the old and new hash
- [ ] SIGINT exits cleanly, never leaving a partially written file on disk

#### Implementation notes

1. Write to a temp file and rename, so an interrupt cannot truncate committed
   output.

#### Affected files

- `packages/abi-registry/src/` (codegen command)
- `orbital.lock.json` handling from 10.4

---

### 10.6 Commit generated output in all three starters

**Labels:** `type:dx` `area:starters`
**Milestone:** Wave 2.2 - orbital codegen
**Effort:** Trivial
**Depends on:** 9.1, 9.2, 9.3, 10.4

#### Description

Phase 2's release gate requires `orbital codegen` "published and used in all
three starter boilerplates". A codegen tool nobody's template uses is a tool
nobody adopts; the starters are the proof-of-use the gate asks for.

#### Acceptance criteria

- [ ] Each starter has an `orbital.config.ts` targeting the deployed `demo-emitter` plus one mainnet well-known contract
- [ ] Generated output is committed and consumed in real code paths, not an unused import
- [ ] Each starter's CI job runs `orbital codegen --check`
- [ ] Each starter README documents the regeneration step

#### Implementation notes

1. If a starter cannot use the generated types in a real path, that is a signal
   about the codegen output, not a reason to add a dead import.

#### Affected files

- `examples/next-starter/`
- `examples/express-starter/`
- `examples/anchor-starter/`
- `.github/workflows/ci.yml`

---

## Wave 11 - Semantic layer

### 11.1 Semantic taxonomy resolver

**Labels:** `type:feature` `area:abi-registry` `needs-design`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** High
**Depends on:** 7.7

#### Description

ROADMAP Wave 2.3 wants `swap.executed` and `loan.liquidated` in place of raw
topic hashes.

Open issue **7.7 owns the taxonomy record format** -
`packages/abi-registry/schemas/taxonomy.schema.json`, the naming rules, and the
validation helper. This issue does not redefine any of that. A schema without a
resolution engine is a file format: something must take a raw event plus its
spec and produce a semantic name deterministically, with conflicts resolved by a
stated rule rather than by whichever mapping loaded first.

#### Acceptance criteria

- [ ] A resolver consumes documents validating against 7.7's `taxonomy.schema.json` - no second, competing record shape is introduced
- [ ] The resolver maps `(contractId, eventTopic, specHash)` to a canonical semantic name
- [ ] Wildcard rules cover 7.7's applicable-contract scopes (specific ID, WASM hash, SEP-interface match)
- [ ] Precedence is exact contract → spec-hash family → interface match → unmapped, with ties resolving to the more specific rule
- [ ] Two equally specific conflicting rules are a load-time error, never a silent pick - this implements 7.7's collision policy, it does not invent one
- [ ] `semantic` is populated on the normalized contract event only when a mapping resolves - never guessed
- [ ] An initial taxonomy covers SAC transfer/mint/burn/clawback and the mainnet AMM swap shapes
- [ ] Tests cover precedence, wildcard, conflict error and unmapped passthrough

#### Implementation notes

1. Blocked on 7.7 landing. If 7.7's collision policy turns out to be
   unimplementable as written, fix it in 7.7 rather than diverging here.

#### Affected files

- `packages/abi-registry/src/` (taxonomy resolver, new)
- `packages/abi-registry/schemas/taxonomy.schema.json` (from 7.7, consumed)
- `packages/pulse-core/src/events.ts`

---

### 11.2 Entity labels: contract to protocol, deployer and issuer attribution

**Labels:** `type:feature` `area:abi-registry` `needs-design`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** High
**Depends on:** none

#### Description

ROADMAP Wave 2.3 calls for verified contract → protocol / deployer /
asset-issuer attribution, published as open data.

A decoded event reading `transfer(GABC..., GDEF..., 1000000)` is still opaque.
Attribution - "this is Soroswap's router", "this issuer is Circle" - is what
makes an event stream readable, and it is the one piece that cannot be derived
from on-chain data alone.

#### Acceptance criteria

- [ ] `packages/abi-registry/schemas/label.schema.json` defines the record: `contractId`/`address`, `label`, `entityType` (protocol | issuer | deployer | bridge | unknown), `confidence`, `sources[]`, `verifiedAt`, `submittedBy`
- [ ] The schema follows 7.7's conventions for provenance and scope fields, so taxonomy and label records read as one family
- [ ] Labels live as one reviewable JSON file per entity under `data/labels/`, so review is a normal PR diff
- [ ] A resolver attaches labels to normalized events behind an opt-in flag - labels are advisory, never load-bearing for correctness
- [ ] CI rejects any record without at least one verifiable source URL
- [ ] Seed data covers Circle USDC/EURC, AQUA and the top mainnet protocols by contract activity

#### Implementation notes

1. 7.7 schemas taxonomy entries only; labels have no schema yet, so this issue
   adds the sibling. Match its file layout (`packages/abi-registry/schemas/`)
   rather than starting a second convention.
2. Open issue 7.8 documents the submission flow for both record types - do not
   write submission docs here, supply the schema it references.

#### Affected files

- `packages/abi-registry/schemas/label.schema.json` (new)
- `data/labels/` (new)
- `packages/abi-registry/src/` (label resolver, new)

---

### 11.3 Automate validation and review of taxonomy and label submissions

**Labels:** `type:dx` `area:abi-registry`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** Medium
**Depends on:** 7.8, 11.1, 11.2

#### Description

Open issue **7.8 owns the submission documentation** -
`docs/semantic-layer/submitting.md` plus worked examples. This issue does not
rewrite it; it automates the flow that document describes.

Written instructions alone leave review as a bespoke argument in a PR thread:
nothing checks that a submission validates, nothing catches a duplicate, and
nothing verifies the evidence a reviewer is supposed to weigh.

#### Acceptance criteria

- [ ] Issue-form templates exist for taxonomy mapping and entity label submissions, with required fields generated from 7.7's and 11.2's schemas
- [ ] A CI validator runs on any `data/` or `packages/abi-registry/schemas/examples/` change: schema validation, dedupe against existing records, source-URL well-formedness, and a summary comment
- [ ] The PR template has a reviewer checklist covering source verification, matching the review checks 7.8 documents
- [ ] The conflict-of-interest rule for self-labeling is enforced by the validator (flags a submission whose `submittedBy` matches the entity being labeled), not only stated in prose
- [ ] These PRs are auto-labeled `area:semantic-data`

#### Implementation notes

1. If 7.8's documented flow and this automation disagree, 7.8 is the spec - fix
   the workflow, or amend 7.8 deliberately.
2. Anything a reviewer would otherwise check by hand belongs in the validator.

#### Affected files

- `.github/ISSUE_TEMPLATE/`
- `.github/pull_request_template.md`
- `.github/workflows/validate-data.yml` (new)
- `docs/semantic-layer/submitting.md` (from 7.8, referenced)

---

### 11.4 Publish taxonomy and labels as open data

**Labels:** `type:feature` `area:abi-registry`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** Medium
**Depends on:** 11.1, 11.2

#### Description

`docs/open-source-policy.md` is explicit: the data is open, the operated service
is the product. Data that only exists inside an npm package is not open data -
it is a dependency. Other tools need to consume it without adopting Orbital.

#### Acceptance criteria

- [ ] Each release publishes `taxonomy.json` and `labels.json` artifacts carrying a schema version, generation timestamp and record count
- [ ] Artifacts are attached to the GitHub release and served at a stable path on the docs site
- [ ] An integrity manifest gives a SHA-256 per file so consumers can pin
- [ ] `data/LICENSE` states the data license (CC0 or equivalent), distinct from the code's MIT license
- [ ] The consumption path for non-JS tools (plain HTTP fetch, no SDK) is documented

#### Implementation notes

1. Generate the artifacts in the release workflow so they cannot drift from the
   tagged source.

#### Affected files

- `data/LICENSE` (new)
- `.github/workflows/release.yml`
- `apps/web`
- `docs/open-source-policy.md`

---

### 11.5 Registry explorer page

**Labels:** `type:feature` `area:apps-web`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** High
**Depends on:** 8.3, 11.1

#### Description

ROADMAP Wave 2.4 lists a public registry explorer. It is also the most legible
proof to a reviewer that the registry is real - today, verifying it contains
anything requires running a CLI against testnet.

#### Acceptance criteria

- [ ] `/registry` lists registered contracts with publisher, version, spec hash, semantic mappings and labels
- [ ] A per-contract detail page shows the full spec, version history, and the last N decoded events from the live stream
- [ ] Every value is fetched live from chain or the hosted API - no hardcoded arrays, no placeholder rows, no "coming soon" cards that read as data
- [ ] An unavailable source renders an explicit error state
- [ ] Contract IDs link to stellar.expert and spec hashes link to their artifact
- [ ] The page is server-rendered with a short cache TTL and displays `fetchedAt`

#### Implementation notes

1. The no-hardcoded-data criterion is not stylistic - mock-wired surface at a
   judging snapshot is what demoted a comparable project a full band.

#### Affected files

- `apps/web/app/registry/` (new)
- `apps/web/app/api/contracts/`
- `packages/abi-registry/src/OnChainAbiRegistryClient.ts`

---

### 11.6 Semantic layer documentation

**Labels:** `type:docs` `good-first-issue`
**Milestone:** Wave 2.3 - Semantic layer
**Effort:** Trivial
**Depends on:** 11.1, 11.2

#### Description

The semantic layer is the least obvious part of the product and the hardest to
explain from API docs alone. Without a worked before/after, "semantic taxonomy"
reads as jargon rather than as the difference between a topic hash and
`swap.executed`.

#### Acceptance criteria

- [ ] `docs/semantic-layer.md` explains what a mapping is, what a label is, how precedence resolves, and what is deliberately not inferred
- [ ] One real mainnet event is shown three ways: raw XDR, decoded, semantic and labeled
- [ ] The honesty rule is stated explicitly: unmapped events stay unmapped, the layer never guesses a name
- [ ] Linked from `README.md` and `docs/ARCHITECTURE.md`

#### Implementation notes

1. Pull the worked example from a real stream capture, not a hand-written
   payload.

#### Affected files

- `docs/semantic-layer.md` (new)
- `README.md`
- `docs/ARCHITECTURE.md`

---

## Wave 12 - Hosted registry

### 12.1 Hosted read API for schemas, taxonomy and labels

**Labels:** `type:feature` `area:apps-web`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** High
**Depends on:** 8.3, 11.1, 11.2

#### Description

Resolving a spec today means an RPC round trip per unknown contract. At any real
request rate that is slow and rate-limited, and every integration is coupled to
one RPC endpoint's availability.

#### Acceptance criteria

- [ ] `GET /v1/registry/spec/:contractId[?version=]`, `/v1/registry/taxonomy`, `/v1/registry/labels` and `/v1/registry/health` all serve live data
- [ ] Every response includes `servedFrom`, `asOfLedger` and the spec hash
- [ ] Reads go through a read-through cache with an explicit TTL and `stale-while-revalidate`; stale data is never served silently
- [ ] `/health` reports the last-sync ledger
- [ ] An OpenAPI description is published at `/v1/registry/openapi.json`

#### Implementation notes

1. Version the path from day one - the client in 12.2 pins to `/v1/`.

#### Affected files

- `apps/web/app/api/registry/` (new)
- `packages/abi-registry/src/OnChainAbiRegistryClient.ts`

---

### 12.2 Hosted-API client with automatic chain fallback

**Labels:** `type:feature` `area:abi-registry`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** Medium
**Depends on:** 12.1

#### Description

`ChainedAbiRegistryClient` already composes resolution sources behind an LRU/TTL
cache. If the hosted API becomes a link in that chain, an outage there must
degrade to a direct chain read - otherwise the operated service becomes a single
point of failure for an MIT library.

#### Acceptance criteria

- [ ] `HostedAbiRegistryClient` hits the `/v1/` endpoints with a configurable base URL and timeout
- [ ] It sits ahead of the on-chain client in the default chain and falls through on timeout, 5xx, or hash mismatch
- [ ] Returned spec hashes are verified against chain on a sampled basis (configurable, default 1 in 20), with a hard error logged on mismatch
- [ ] One config flag opts out of the hosted link entirely for chain-only resolution
- [ ] Tests cover hosted hit, timeout fallback, and hash-mismatch fallback with error log

#### Implementation notes

1. A hash mismatch means the hosted service returned a spec the chain does not
   attest to - fail loudly, never prefer the faster answer.

#### Affected files

- `packages/abi-registry/src/HostedAbiRegistryClient.ts` (new)
- `packages/abi-registry/src/ChainedAbiRegistryClient.ts`
- `packages/abi-registry/src/createDefaultAbiRegistryClient.ts`

---

### 12.3 Verification pipeline for submitted schemas

**Labels:** `type:security` `area:abi-registry`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** High
**Depends on:** 8.3

#### Description

ROADMAP Wave 2.4 requires a pipeline cross-checking submitted schemas against
on-chain `contractspec`. `packages/abi-registry/src/verifySchema.ts` already
implements the core comparison (shipped in #32).

Verification exists as a library function but not as an enforced pipeline. An
unverified schema in a "canonical" registry is worse than no registry, because
consumers will trust it.

#### Acceptance criteria

- [ ] A scheduled job walks every registered spec, fetches the contract's on-chain `contractspec`, and records a dated verdict
- [ ] Verdicts are `verified` | `mismatch` | `unverifiable` and are exposed on the hosted API and the explorer page
- [ ] A mismatch marks the spec prominently and opens an issue automatically
- [ ] Pre-SEP-48 contracts with no embedded spec are `unverifiable` and displayed as attested-only, never as verified
- [ ] A transition from `verified` to `mismatch` raises an alert

#### Implementation notes

1. Coordinates with open issues 7.3 and 7.4 (attestation schema and signature
   envelope).

#### Affected files

- `packages/abi-registry/src/verifySchema.ts`
- verification job and verdict storage (new)
- `apps/web/app/registry/`

---

### 12.4 Rate limiting and abuse controls on the hosted API

**Labels:** `type:security` `area:apps-web`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** Medium
**Depends on:** 12.1

#### Description

A public read API in front of a funded chain account and a paid host is an open
invitation. Unbounded reads pass straight through to RPC, converting a traffic
spike into a bill and an outage simultaneously.

#### Acceptance criteria

- [ ] Per-IP and per-key rate limits return `429` with `Retry-After`, mirroring how `pulse-core` handles Horizon rate limits
- [ ] Edge caching sets correct `Cache-Control` and `ETag`; conditional requests return `304`
- [ ] A hard ceiling caps chain reads per minute; beyond it the API serves stale with an explicit `servedFrom: "stale"` rather than exhausting the RPC budget
- [ ] List endpoints enforce request-size and query-cardinality limits
- [ ] A documented load test records sustained RPS and behavior at the ceiling

#### Implementation notes

1. Reuse the backoff and retry policy already established in
   `packages/pulse-core/src/backoff.ts` rather than inventing a second one.

#### Affected files

- `apps/web/app/api/registry/`
- rate-limit middleware (new)
- `packages/pulse-core/src/backoff.ts`

---

### 12.5 Observability and SLOs for the hosted API

**Labels:** `type:ops` `area:apps-web`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** Medium
**Depends on:** 12.1

#### Description

`packages/pulse-webhooks` already ships `OtelWebhookMetrics` and
`PrometheusWebhookMetrics`, so the repo has an established metrics idiom.

"Serving reads in production" is only claimable with evidence. Without
instrumentation there is no way to state uptime, latency, or cache hit rate.

#### Acceptance criteria

- [ ] Request count, latency histogram, cache hit ratio, chain-read count and fallback rate are emitted following the existing Otel/Prometheus pattern
- [ ] A resolution is traced end to end (API → cache → chain) with the spec hash as a span attribute
- [ ] `docs/slo.md` defines availability, p95 latency and freshness-in-ledgers targets
- [ ] An uptime probe hits `/v1/registry/health` and its history is public
- [ ] Every fallback emits a structured log line

#### Implementation notes

1. Mirror `packages/pulse-webhooks/src/OtelWebhookMetrics.ts` so operators have
   one metrics vocabulary across the project.

#### Affected files

- `apps/web/app/api/registry/`
- `packages/pulse-webhooks/src/OtelWebhookMetrics.ts` (pattern reference)
- `docs/slo.md` (new)

---

### 12.6 Long-range replay via Composable Data Platform and CAP-67 backfill

**Labels:** `type:feature` `area:pulse-core` `needs-design`
**Milestone:** Wave 2.4 - Hosted registry
**Effort:** High
**Depends on:** 6.12, 6.14, 8.4

#### Description

Stellar RPC retains roughly seven days of history. ROADMAP Wave 2.4 is explicit
that replay beyond that window is built on the Composable Data Platform (Galexie
exports) and CAP-67 retroactive backfill, **not** an Orbital-operated ledger
store.

Audit and compliance use cases - the anchor starter in particular - need replay
across months. Today a cursor can point at a ledger the RPC no longer serves and
the failure is an opaque error.

#### Acceptance criteria

- [ ] A design doc picks the source (Galexie export bucket vs a `BACKFILL_STELLAR_ASSET_EVENTS`-populated RPC) with cost and latency analysis, signed off by a maintainer before implementation
- [ ] A `HistoricalSource` interface exists that `EventEngine` falls back to when a cursor predates RPC retention
- [ ] One reference adapter is implemented; the interface stays adapter-agnostic
- [ ] A cursor older than RPC retention replays with identical `NormalizedEvent` output
- [ ] Cursor format is compatible with the unified-event cursor work in open issue 6.14 - one cursor spans both transports
- [ ] The e2e harness from closed issue 6.15 is extended to cover the beyond-retention range, not duplicated
- [ ] Out-of-retention errors name the retention boundary and the configured historical source

#### Implementation notes

1. Design doc first. This is the one issue in the backlog where implementing
   before agreeing the source risks building the wrong thing entirely.
2. Closed issue 6.15 already shipped a backfill replay e2e against
   `BACKFILL_STELLAR_ASSET_EVENTS` (skips without the RPC secret). Build on that
   test rather than standing up a parallel one.
3. **Do not add a second source-selection path to `EventEngine`.** Open issue
   6.12 introduces transport routing (RPC for asset events, Horizon for the
   rest) and 6.11 its config flag. `HistoricalSource` must plug into that
   routing as another transport, not bypass it - otherwise the engine ends up
   with two independent notions of "where does this event come from".
4. Cursor format comes from open issue 6.14. Land after it, extend it; do not
   define a third cursor shape.

#### Affected files

- `packages/pulse-core/src/HistoricalSource.ts` (new)
- `packages/pulse-core/src/EventEngine.ts`
- `packages/pulse-core/src/CursorStore.ts`
- `docs/design/long-range-replay.md` (new)

---

## Wave 13 - Production hardening

### 13.1 Backpressure and bounded memory under burst load

**Labels:** `type:perf` `area:pulse-core`
**Milestone:** Hardening - cross-cutting
**Effort:** High
**Depends on:** none

#### Description

`EventEngine` fans out to watchers and, in webhook compositions, into a retry
queue. Both are unbounded.

A slow consumer or a burst of ledger activity grows internal queues without
limit. The failure mode is an OOM in the consuming process well after the cause
has passed - the worst kind of production incident to diagnose.

#### Acceptance criteria

- [ ] A bounded internal queue exists with a configurable high-water mark and an explicit, documented policy at the limit (drop-oldest, drop-newest, or pause the source)
- [ ] `engine.backpressure` is emitted when the mark is crossed and when it clears, matching the existing `engine.*` notification style
- [ ] The webhook retry queue is bounded too, and the concurrent-retry cap holds under load
- [ ] A load test drives 10k synthetic events through a deliberately slow watcher and asserts memory stays bounded
- [ ] `docs/ARCHITECTURE.md` documents the policy and tuning knobs

#### Implementation notes

1. The default policy must be safe and stated, not implicit - silent drops are
   worse than a documented pause.

#### Affected files

- `packages/pulse-core/src/EventEngine.ts`
- `packages/pulse-webhooks/src/RetryQueue.ts`
- `docs/ARCHITECTURE.md`

---

### 13.2 Reconnection and failover chaos tests

**Labels:** `type:test` `area:pulse-core`
**Milestone:** Hardening - cross-cutting
**Effort:** Medium
**Depends on:** none

#### Description

`packages/pulse-core/src/backoff.ts` implements AWS Full-Jitter reconnection and
the engine emits `engine.reconnecting` / `engine.reconnected` /
`engine.rate_limited`.

Reconnection is unit-tested against fakes but never against adversarial
transport behavior - mid-event disconnects, half-open sockets, repeated 429s,
DNS failure, clock jumps. Those are exactly the conditions that produce gaps.

#### Acceptance criteria

- [ ] A fault-injecting mock transport can disconnect mid-frame, stall without closing, return `429` with and without `Retry-After`, and return malformed JSON
- [ ] Every injected fault produces zero event loss and zero duplicate delivery, proven via the cursor
- [ ] Backoff stays within the documented jitter envelope and never busy-loops
- [ ] Transport failover (Horizon ↔ RPC) preserves the dedupe guard from open issue 6.13
- [ ] The suite runs in CI with a fixed seed and nightly with a random seed

#### Implementation notes

1. Seed the randomness so a nightly failure is reproducible from the log.

#### Affected files

- `packages/pulse-core/src/backoff.ts`
- `packages/pulse-core/src/EventEngine.ts`
- `packages/pulse-core/test/chaos/` (new)
- `.github/workflows/ci.yml`

---

### 13.3 Coverage gating

**Labels:** `type:test` `type:ops`
**Milestone:** Hardening - cross-cutting
**Effort:** Medium
**Depends on:** none

#### Description

The repo has a substantial test suite plus type tests (`pnpm test:types`) but no
coverage threshold. Without a floor, coverage drifts down one PR at a time and
nobody can answer a reviewer asking how well-tested the SDK is.

#### Acceptance criteria

- [ ] Coverage is collected per package with a threshold set at current measured coverage minus a small margin
- [ ] CI fails when coverage drops below the floor; raising the floor is a normal PR
- [ ] The report is published as a CI artifact and a badge in `README.md`
- [ ] Generated output and test fixtures are excluded, documented in the config
- [ ] Starting numbers per package are recorded in the PR body as a baseline

#### Implementation notes

1. Ratchet, not cliff - a floor set above current coverage blocks every PR until
   someone backfills tests, which is how coverage gates get disabled.

#### Affected files

- `packages/*/vitest.config.*`
- `.github/workflows/ci.yml`
- `README.md`

---

### 13.4 Performance benchmark suite with regression gating

**Labels:** `type:perf` `area:pulse-core`
**Milestone:** Hardening - cross-cutting
**Effort:** Medium
**Depends on:** none

#### Description

Normalization sits on the hot path of every event, and `decodedData` adds spec
resolution and Zod validation to that path. No benchmark exists, so a change that
halves throughput ships unnoticed until someone runs it at volume.

#### Acceptance criteria

- [ ] Benchmarks cover raw event → `NormalizedEvent` throughput, decode-with-spec throughput, watcher fan-out at 1 / 100 / 1000 watchers, and cursor write cost per adapter
- [ ] Benchmarks run against the recorded CAP-67 fixture corpus for reproducibility
- [ ] Results are stored as JSON and compared against a committed baseline in CI
- [ ] A regression greater than 20% fails the build
- [ ] Updating the baseline requires a justification in the PR body, documented in the process
- [ ] `docs/ARCHITECTURE.md` records current numbers and the hardware they were measured on

#### Implementation notes

1. Fixture-driven, not network-driven - a benchmark that hits testnet measures
   the network.

#### Affected files

- `packages/pulse-core/bench/` (new)
- `.github/workflows/ci.yml`
- `docs/ARCHITECTURE.md`

---

### 13.5 Bundle size budgets for browser packages

**Labels:** `type:perf` `area:pulse-notify` `good-first-issue`
**Milestone:** Hardening - cross-cutting
**Effort:** Trivial
**Depends on:** none

#### Description

`@orbital-stellar/pulse-notify` ships to the browser and CI already has a
bundle-size job. Without an enforced budget, a transitive dependency can add
hundreds of kilobytes to every consumer's client bundle and nothing turns red.

#### Acceptance criteria

- [ ] Each browser-facing entry point has a raw and gzipped size budget
- [ ] Exceeding a budget fails CI, printing the delta and the top contributing modules
- [ ] A fixture bundle asserts tree-shaking: importing one hook does not pull the whole package
- [ ] Current sizes are recorded in `README.md`

#### Implementation notes

1. Set budgets from measured current size plus a small headroom, same ratchet
   logic as 13.3.

#### Affected files

- `.github/workflows/ci.yml`
- `packages/pulse-notify/package.json`
- `README.md`

---

### 13.6 Security hardening pass on secret handling

**Labels:** `type:security`
**Milestone:** Hardening - cross-cutting
**Effort:** Medium
**Depends on:** 8.2, 8.5

#### Description

Wave 8 introduces signing keys into CI and into the web app's server runtime -
the first time this repo handles a key that can move value. Key handling
introduced feature-by-feature drifts into leaks; it needs one deliberate pass
and a written policy before more surfaces touch keys.

#### Acceptance criteria

- [ ] Every path that reads a secret is audited; none reaches a client bundle, a log line, or an error message
- [ ] A CI grep gate over built output enforces that
- [ ] `SECURITY.md` documents scope and rotation for `SOROBAN_INVOKER_SECRET`, `NPM_TOKEN` and the demo invoker key
- [ ] A startup assertion refuses a mainnet secret in demo and CI paths
- [ ] The dependency policy - allowed license set, automated audit gate, response window for a critical advisory - is documented
- [ ] SSRF hardening in `url-validator.ts` is re-verified against the registry-fetch paths added in Wave 12

#### Implementation notes

1. The grep gate is the durable part - an audit without one decays within a
   quarter.

#### Affected files

- `SECURITY.md`
- `packages/pulse-webhooks/src/url-validator.ts`
- `.github/workflows/security.yml`

---

## Wave 14 - Anchor events

### 14.1 anchor-sdk package scaffold and SEP-24 client

**Labels:** `type:feature` `area:starters` `needs-design`
**Milestone:** Phase 3 - Anchor events (v2.0.0)
**Effort:** High
**Depends on:** 12.1

#### Description

Phase 3's gate: `@orbital-stellar/anchor-sdk` on npm with SEP-24 and SEP-31
lifecycle events normalized into the standard taxonomy.

Anchor integrations today are hand-rolled polling loops against
`/transactions`, with each team re-deriving the same status machine and each
getting the edge cases slightly wrong.

#### Acceptance criteria

- [ ] The package follows the repo's existing build, test and publish conventions
- [ ] A typed SEP-24 client implements SEP-1 discovery, SEP-10 authentication, interactive deposit/withdrawal initiation and transaction polling
- [ ] The SEP-24 status machine is a typed state union with explicit transition validation - an illegal transition is an error, not a silent overwrite
- [ ] The SDK authenticates via SEP-10 against a live testnet anchor and polls a deposit to completion
- [ ] Recorded fixtures back CI so the suite does not depend on a third party's uptime
- [ ] The SDK never persists a signing key, and key handling is documented

#### Implementation notes

1. Pick the testnet anchor in the design step - fixture shape depends on it.

#### Affected files

- `packages/anchor-sdk/` (new)
- `packages/pulse-core/src/events.ts` (taxonomy reference)

---

### 14.2 SEP-31 cross-border payment lifecycle

**Labels:** `type:feature` `area:starters`
**Milestone:** Phase 3 - Anchor events (v2.0.0)
**Effort:** High
**Depends on:** 14.1

#### Description

SEP-31 is the sending-anchor to receiving-anchor rail and the one closest to
regulated-money reporting requirements. It has its own status machine and its own
error semantics; folding it into SEP-24's model would lose exactly the
distinctions compliance teams need.

#### Acceptance criteria

- [ ] The SEP-31 client implements `/info`, transaction initiation, status polling and the SEP-12 customer-info dependency
- [ ] The SEP-31 status machine is modeled separately with its own transition validation
- [ ] Both machines normalize into shared `anchor.*` taxonomy events while preserving the protocol-specific status in a typed sub-field
- [ ] The required-fields negotiation loop is handled explicitly, with typed errors naming the missing field
- [ ] Fixture-backed tests cover the full lifecycle including a rejection path
- [ ] A SEP-31 payment runs end to end against a testnet anchor

#### Implementation notes

1. Preserve protocol-specific status alongside the normalized event - the
   normalization must not be lossy for compliance consumers.

#### Affected files

- `packages/anchor-sdk/`
- `packages/pulse-core/src/events.ts`

---

### 14.3 Anchor lifecycle taxonomy

**Labels:** `type:feature` `area:pulse-core`
**Milestone:** Phase 3 - Anchor events (v2.0.0)
**Effort:** Medium
**Depends on:** 14.1

#### Description

ROADMAP Phase 3 requires anchor events mapped into the same normalized taxonomy
as on-chain events - one stream, one type surface.

Off-chain anchor state transitions and on-chain settlement are two views of one
payment. If they arrive as two unrelated event shapes, every consumer writes its
own correlation logic.

#### Acceptance criteria

- [ ] `anchor.deposit.*`, `anchor.withdrawal.*` and `anchor.payment.*` are members of the `NormalizedEvent` union
- [ ] `packages/pulse-core/test/types.exhaustive.test-d.ts` covers them and the union stays exhaustively narrowable with no `default` clause
- [ ] Anchor events correlate to their on-chain settlement transaction where the anchor exposes the hash
- [ ] Where the anchor does not expose it, the field is explicitly `null` - never inferred
- [ ] `docs/design/anchor-taxonomy.md` maps each SEP status to each taxonomy event

#### Implementation notes

1. The null-not-guessed rule is the same honesty constraint as the semantic
   layer's - correlation invented from timing would be indistinguishable from
   fabricated data.

#### Affected files

- `packages/pulse-core/src/events.ts`
- `packages/pulse-core/test/types.exhaustive.test-d.ts`
- `docs/design/anchor-taxonomy.md` (new)

---

### 14.4 Replay-safe anchor delivery recipes

**Labels:** `type:docs`
**Milestone:** Phase 3 - Anchor events (v2.0.0)
**Effort:** Medium
**Depends on:** 9.3, 14.3

#### Description

ROADMAP Phase 3 calls for cursor and retry-queue compositions documented for
audit-trail use cases.

The composition that makes anchor delivery audit-grade is subtle - cursor
placement, idempotency keys, dead-letter policy and retention interact - and
getting it wrong produces a plausible-looking audit log with gaps in it.

#### Acceptance criteria

- [ ] Recipes cover at-least-once anchor delivery with idempotency keys, reconstructing a full audit trail from cursor plus dead-letter store, and handling an anchor that revises a past status
- [ ] Every recipe is extracted from code that runs in `examples/anchor-starter/`, not written free-hand
- [ ] Each recipe states the failure modes it does not cover
- [ ] A verification script replays a captured trail and diffs it against the live anchor's current state

#### Implementation notes

1. If a recipe cannot be extracted from running starter code, the gap is in the
   starter, not the doc.

#### Affected files

- `docs/COOKBOOK.md`
- `examples/anchor-starter/`
- `packages/pulse-webhooks/src/DeadLetterStore.ts`

---

## Wave 15 - The SEP draft

> ROADMAP Wave 2.1 calls this "the highest-leverage item on the roadmap" and
> Phase 2's release gate requires a draft submitted to `stellar/stellar-protocol`.
> Existing issues 7.1-7.10 are all *inputs* to the draft - gap memo, prior-art
> survey, attestation schema, signature envelope, taxonomy schema, examples.
> Nothing on either tracker actually writes or submits the document. These two
> issues close that gap.

### 15.1 Write the SEP draft

**Labels:** `type:docs` `area:abi-registry` `needs-design` `priority:critical`
**Milestone:** Wave 2.1 - SEP draft
**Effort:** High
**Depends on:** 7.1, 7.2, 7.3, 7.4, 7.7, 10.1

#### Description

ROADMAP Wave 2.1 defines the draft's scope: (a) an off-chain schema registry
with a verification pipeline cross-checking against on-chain `contractspec`,
(b) retroactive schema attestation for pre-SEP-48 contracts already deployed on
mainnet, and (c) a semantic taxonomy and entity-label format on top of raw event
schemas - plus a compatibility clause making an embedded SEP-48 spec canonical.

Ten issues feed this document and none produce it. Prep artifacts that never
converge into a submitted draft are the "spec-docs instead of code" failure in
reverse: real code with no standard to make it canonical.

#### Acceptance criteria

- [ ] `docs/sep/orbital-registry-sep.md` covers all three scope areas plus the SEP-48 compatibility clause
- [ ] The compatibility clause states plainly that an embedded SEP-48 event spec is the canonical schema source and the registry adds attestation and semantics on top, never a competing schema
- [ ] Every normative clause cites the prep artifact it rests on (7.1 gap memo, 7.2 prior-art survey, 7.3 attestation schema, 7.4 signature envelope, 7.7 taxonomy schema)
- [ ] A reference-implementation checklist maps every clause to the code in this repo that implements it, with file paths
- [ ] Any clause with no implementing code is listed explicitly as unimplemented rather than quietly omitted
- [ ] The draft follows the formatting conventions of accepted SEPs in `stellar/stellar-protocol`

#### Implementation notes

1. Write against shipped code, not planned code. A clause the repo does not
   implement weakens the whole draft at review.
2. The checklist is the strongest part of the submission - it is what
   distinguishes this from a proposal with no implementation behind it.

#### Affected files

- `docs/sep/orbital-registry-sep.md` (new)
- `docs/sep/reference-implementation-checklist.md` (new)
- `ROADMAP.md` (tick Wave 2.1 items)

---

### 15.2 Submit the SEP as a draft PR to stellar/stellar-protocol

**Labels:** `type:docs` `maintainer-only`
**Milestone:** Wave 2.1 - SEP draft
**Effort:** Trivial
**Depends on:** 15.1

#### Description

Phase 2's release gate is "SEP draft submitted to `stellar/stellar-protocol`" -
submitted, not written. A draft sitting in this repo does not meet it.

#### Acceptance criteria

- [ ] A draft PR is open against `stellar/stellar-protocol` with the document from 15.1
- [ ] The PR description links the reference-implementation checklist and the deployed registry contract ID from 8.1
- [ ] The SEP number assigned (or requested) is recorded in `ROADMAP.md` and `docs/sep/`
- [ ] A tracking issue is opened in this repo for review feedback, so clause changes flow back into the implementation
- [ ] `CHANGELOG.md` records the submission

#### Implementation notes

1. Submit only after 8.1 - a draft whose reference implementation points at an
   undeployed contract invites the first reviewer question you cannot answer.

#### Affected files

- `ROADMAP.md`
- `CHANGELOG.md`
- `docs/sep/`

---

## Dependency order

```
8.1 ─┬─ 8.2 ─┐
     ├─ 8.3 ─┼─ 8.4 ─┬─ 9.6 (also 9.1, 9.2, 9.3, 9.5) ─ 9.7
     ├─ 8.5 ─┘       └─ 12.6
     ├─ 8.6
     ├─ 8.7
     ├─ 8.8
     ├─ 9.1 ─┐
     └─ 9.2 ─┴─ 9.3 ─┬─ 10.6 (also 10.4)
                     └─ 14.4 (also 14.3)

8.2 + 8.5 ─ 13.6          8.3 ─ 12.3
10.4 ─ 10.5

11.1 ─┬─ 11.3            12.1 ─┬─ 12.2
11.2 ─┤                        ├─ 12.4
      ├─ 11.4                  ├─ 12.5
      ├─ 11.5 (also 8.3)       └─ 14.1 ─┬─ 14.2
      └─ 11.6                            └─ 14.3 ─ 14.4
```

**Startable today:** 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 11.2, 13.1, 13.2, 13.3,
13.4, 13.5 - plus **8.1**, which is maintainer-only and gates the band.
