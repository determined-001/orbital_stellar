# ABI Registry — Specs

This directory contains Soroban contract ABI specs for the Orbital ABI Registry.

## Directory layout

```
specs/
└── well-known/
    ├── schema.json              # JSON Schema every spec must conform to
    ├── index.json               # Machine-readable index of all well-known specs
    ├── sac-interface.json       # Common SAC / SEP-41 interface (reference)
    ├── native-asset-wrapper.json
    ├── usdc.json
    ├── eurc.json
    └── aqua.json
```

---

## What are well-known specs?

A **well-known spec** is a pre-seeded ABI spec that ships with the registry and is maintained by the Orbital project. These specs cover the most widely-deployed token contracts on Stellar mainnet so that consumers can decode contract events without having to locate or author the spec themselves.

Well-known specs live under `specs/well-known/` and are versioned alongside the registry package.

---

## Spec format

Every spec is a JSON file that conforms to `specs/well-known/schema.json`. The required top-level fields are:

| Field | Type | Description |
|---|---|---|
| `version` | `string` | Spec revision in `MAJOR.MINOR.PATCH` semver format. |
| `name` | `string` | Human-readable contract name (1–100 characters). |
| `description` | `string` | Short description of the contract's purpose (1–500 characters). |
| `contract_id` | `string` | Canonical mainnet Soroban contract address — C-prefixed strkey, 56 characters. |
| `network` | `"mainnet" \| "testnet" \| "futurenet"` | Stellar network this spec targets. |
| `source` | `string` | URL or reference identifying where the interface definition was obtained. |
| `functions` | `array` | List of callable contract functions (at least one entry required). |

Optional fields: `tags` (string array).

Each entry in `functions` must have:
- `name` — function name as it appears in the contract ABI.
- `params` — ordered array of `{ name, type }` objects (Soroban XDR type names such as `Address`, `i128`, `u32`, `String`, `bool`).
- `outputs` — ordered array of `{ type }` objects; empty array for void functions.
- `doc` — optional human-readable description (on the function or any param/output).

---

## Curation policy

### Criteria for inclusion

A contract qualifies as a well-known spec when it meets **all** of the following:

1. **Mainnet deployment** — the contract is deployed and active on Stellar mainnet with a verifiable C-prefixed contract address.
2. **Public interface** — the contract interface is publicly documented or derivable via `stellar contract info interface --network mainnet --id <CONTRACT_ID>`.
3. **Community adoption** — the contract is integrated by at least three independent production applications, or has processed at least 10,000 mainnet transactions.
4. **Stable interface** — the contract interface is not expected to change without a migration path (i.e., it is not an experimental or alpha deployment).

### Initial well-known specs

| Spec file | Contract ID | Rationale |
|---|---|---|
| `sac-interface.json` | *(placeholder — SAC addresses are per-asset)* | Reference interface for all SACs; every Stellar classic asset can be wrapped as a SAC. |
| `native-asset-wrapper.json` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | XLM is the native Stellar asset and the most widely used token on the network. |
| `usdc.json` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` | USDC is the dominant USD stablecoin on Stellar, issued by Circle. |
| `eurc.json` | `CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV` | EURC is Circle's MiCA-compliant EUR stablecoin on Stellar, launched 2023-09-26. |
| `aqua.json` | `CAUIKL3IYGMERDRUN5QQVPKPLZTRNVXV27LFCWQIRNOHSNGB3ZXAEFBX` | AQUA is the governance and liquidity incentive token of the Aquarius protocol, held by 120K+ wallets. |

> **SAC contract IDs** are derived deterministically from the classic asset. To verify or derive an address:
> ```
> stellar contract id asset --asset CODE:ISSUER --network mainnet
> stellar contract id asset --asset native --network mainnet
> ```

---

## Adding a new well-known spec

1. **Check eligibility** — confirm the contract meets all four criteria above.
2. **Derive the contract ID** — use the Stellar CLI or SDK to obtain the canonical C-prefixed address.
3. **Author the spec** — create `specs/well-known/<token-symbol-lowercase>.json` following the schema. Run `pnpm --filter @orbital/abi-registry validate` to confirm it passes before opening a PR.
4. **Update the index** — add an entry to `specs/well-known/index.json` with `name`, `contract_id`, `file`, `description`, and `tags`.
5. **Open a pull request** — include:
   - The new spec file.
   - The updated `index.json`.
   - Evidence of mainnet deployment (explorer link or CLI output).
   - Evidence of community adoption (links to integrations or on-chain transaction count).
6. **Review** — a maintainer will verify the contract ID, check the interface against the on-chain WASM, and merge once the spec is confirmed correct.

---

## Updating an existing well-known spec

If a contract is upgraded or its interface changes:

1. Bump the `version` field in the spec file following semver (patch for doc-only changes, minor for new functions, major for breaking changes).
2. Update the `functions` array to reflect the new interface.
3. Add a note in the PR description explaining what changed and linking to the upgrade transaction or announcement.
4. If the contract ID changes (new deployment), update `contract_id` and the `index.json` entry, and add a comment in the PR explaining the migration.

---

## Deprecating or removing a well-known spec

A well-known spec is deprecated when:
- The contract is no longer actively used (fewer than 100 transactions in the past 90 days on mainnet).
- The issuer has publicly announced end-of-life for the contract.
- A successor contract has been deployed and the original is frozen or drained.

Deprecation process:
1. Open a PR adding a `"deprecated": true` field to the spec and a `"deprecated_reason"` string explaining why.
2. The spec remains in the registry for one release cycle (minimum 30 days) before removal, to give consumers time to migrate.
3. Removal is a breaking change and requires a major version bump of the registry package.

---

## Validation workflow

All specs are validated against `specs/well-known/schema.json` using the `validate` script.

**Run validation locally:**

```bash
# From the repo root
pnpm --filter @orbital/abi-registry validate

# Or from the package directory
cd packages/abi-registry
node validate.js
```

**What the validator checks:**
- The file parses as valid JSON.
- All required fields are present (`version`, `name`, `description`, `contract_id`, `network`, `source`, `functions`).
- Field types and constraints match the schema (e.g. `contract_id` matches the C-prefixed strkey pattern, `version` is valid semver, `functions` is non-empty).
- No extra fields are present (`additionalProperties: false`).

**Exit codes:**
- `0` — all specs pass.
- `1` — one or more specs fail; errors are printed to stderr with the file path and the failing field.

CI runs `pnpm --filter @orbital/abi-registry validate` on every pull request that touches `packages/abi-registry/`.
