# Contributing to Orbital

Thank you for your interest in contributing. This guide covers everything you need to go from zero to an open pull request.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setting up the repo](#setting-up-the-repo)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Opening a pull request](#opening-a-pull-request)
- [Stellar Wave Program](#stellar-wave-program)
- [Adding yourself to the contributors list](#adding-yourself-to-the-contributors-list)

---

## Prerequisites

- **Node.js** 20 or 22 (both are tested in CI)
- **pnpm** 10 — install with `npm install -g pnpm@10`
- **Git**

---

## Setting up the repo

```bash
git clone https://github.com/determined-001/orbital_stellar.git
cd orbital_stellar
pnpm install
```

That installs all workspace packages. No additional steps are needed to run the test suite or typecheck.

---

## Project structure

```
orbital/
├── packages/
│   ├── pulse-core/       # EventEngine, Watcher, Horizon + RPC streaming
│   ├── pulse-webhooks/   # HMAC delivery, retry, SSRF protection
│   └── pulse-notify/     # React hooks
├── apps/
│   └── web/              # Next.js marketing + documentation site
├── tsconfig.base.json    # Shared TypeScript config
└── pnpm-workspace.yaml
```

Each package is an independent TypeScript project with its own `tsconfig.json`, `package.json`, and test suite.

---

## Development workflow

**Typecheck everything:**
```bash
pnpm -r typecheck
```

**Typecheck one package:**
```bash
pnpm tsc --noEmit -p packages/pulse-core/tsconfig.json
```

**Run all tests:**
```bash
pnpm test
```

**Run tests for one package:**
```bash
pnpm --filter @orbital/pulse-core test
```

**Run tests in watch mode:**
```bash
pnpm --filter @orbital/pulse-core exec vitest
```

**Start the marketing/docs site:**
```bash
pnpm --filter orbital/web dev
```

---

## Coding standards

- **TypeScript strict mode** is on everywhere — no `any`, no type assertions without justification.
- **No comments** that describe what the code does. Only add a comment when the *why* is non-obvious (a hidden constraint, a workaround for a specific upstream bug, a subtle invariant).
- **No unused exports.** If you add a public export, it must be used or documented.
- **Error handling at system boundaries only.** Don't add try/catch inside internal functions unless there is a clear, specific failure mode to handle.
- **Conventional commits** — prefix your commit messages:
  - `feat:` new behaviour
  - `fix:` bug fix
  - `docs:` documentation only
  - `test:` test only
  - `refactor:` no behaviour change
  - `perf:` performance improvement
  - `chore:` tooling, deps, config

---

## Testing

All packages use [Vitest](https://vitest.dev). Tests live in `packages/<name>/test/`.

- Write a test for every new public API.
- Update existing tests when you change behaviour.
- Coverage is tracked with `@vitest/coverage-v8`. Run `pnpm --filter @orbital/pulse-core test:coverage` to generate a report.

CI runs tests on Node 20 and Node 22. Make sure your changes pass on both.

---

## Opening a pull request

1. **Find or create an issue** that describes the change. Link it in your PR.
2. **Fork the repo** and create a branch: `git checkout -b feat/my-change`.
3. **Make your changes**, keeping commits focused and conventional.
4. **Run the full check locally** before pushing:
   ```bash
   pnpm -r typecheck && pnpm test
   ```
5. **Open the PR** against `main`. Fill in the template — what changed, why, and how to test it.
6. **Respond to review feedback.** A maintainer will review within a few days.

PRs that change public APIs require a description of the migration path. Breaking changes will not be merged until a major version is planned.

---

## Stellar Wave Program

Orbital participates in the [Drips Stellar Wave Program](https://drips.network). Issues tagged `Stellar Wave` are eligible for point rewards.

**Complexity tiers:**

| Label | Points |
|---|---|
| `complexity:trivial` | 100 |
| `complexity:medium` | 150 |
| `complexity:high` | 200 |

**To claim an issue:**
1. Comment on the issue to signal intent.
2. A maintainer will assign it to you.
3. Submit your PR within **14 days** of assignment. If you need more time, comment on the issue and we will extend it.
4. Issues tagged `good-first-issue` are scoped for newcomers — start there if this is your first contribution.

One open issue per contributor at a time for `good-first-issue` items.

---

## Adding yourself to the contributors list

Orbital uses the [all-contributors](https://allcontributors.org) specification to recognize every kind of contribution — code, docs, design, infrastructure, bug reports, reviews, ideas, and more.

The contributor table in the [README](README.md#contributors) is maintained by the all-contributors GitHub Action. If your work has been merged and your name is not in the table, you can add yourself in one of two ways.

### Option 1 — Ask the bot (recommended)

Comment on any open issue or pull request:

```
@all-contributors please add @your-github-username for code, doc
```

Use as many [contribution types](https://allcontributors.org/docs/en/emoji-key) as apply, separated by commas. The bot will open a pull request that updates `.all-contributorsrc` and re-renders the README table. A maintainer merges it.

**Common contribution types:**

| Type | Emoji | When to use |
|---|---|---|
| `code` | 💻 | Merged code in any package |
| `doc` | 📖 | Docs, READMEs, this file, the marketing site content |
| `infra` | 🏗️ | CI workflows, Dependabot config, tooling |
| `maintenance` | 🚧 | Issue triage, PR review, dependency upkeep |
| `test` | ⚠️ | New or significantly expanded tests |
| `review` | 👀 | Reviewed pull requests |
| `bug` | 🐛 | Reported a confirmed bug |
| `ideas` | 🤔 | Proposed a feature that shipped |
| `design` | 🎨 | UI / visual / brand work |

The full key lives at [allcontributors.org/docs/en/emoji-key](https://allcontributors.org/docs/en/emoji-key).

### Option 2 — Open a pull request manually

Edit `.all-contributorsrc`, add an entry under `"contributors"` with your GitHub login, display name, avatar URL (`https://github.com/<username>.png?size=100`), profile URL, and a `contributions` array. Then run `npx all-contributors generate` to re-render the README table and commit both files together.

### What the table represents

The curated table in the README is the **all-contributors** set — explicitly recognized contributions across every category. It is not the same as the full git author list. For the complete commit history including everyone who has ever pushed code, see the [GitHub contributor graph](https://github.com/determined-001/orbital_stellar/graphs/contributors).

If you contributed before all-contributors was adopted (`v0.1.0` release timeframe) and your name is in the git history but not the table, please open an issue or comment on a PR with your preferred GitHub login — we will add you.
