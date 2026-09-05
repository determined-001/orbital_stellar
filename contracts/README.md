# Orbital contracts

Soroban smart contracts backing Orbital's semantic layer. This is a standalone
Cargo workspace - it is **not** part of the pnpm workspace (`pnpm-workspace.yaml`
only globs `packages/*` and `apps/*`); it has its own toolchain and CI job.

## Contracts

- **`registry`** (`orbital-abi-registry`) - the on-chain ABI registry.
  `publish(publisher, contract_id, version, spec_hash, pointer)` records an
  immutable `(contract_id, publisher, version) -> SpecRecord` mapping, requires
  the publisher's authorization, and emits a `SpecPublished` event. Stores a
  hash + off-chain pointer, not the spec blob itself - integrity is verified by
  the caller re-hashing whatever it fetches from `pointer` and comparing it to
  `spec_hash`.
- **`demo-emitter`** (`orbital-demo-emitter`) - a tiny no-args `ping()` contract
  that emits a `Ping` event. Exists solely so the public `/demo/contracts` page
  can offer a "Fire test event" button without ever touching the registry
  contract's real publish path.
- **`payroll`** (`orbital-payroll`) - the reference contract for the worker
  layer's first rule, **the trigger is not the custodian**
  ([`docs/design/workers.md`](../docs/design/workers.md)). `configure()`,
  `fund()`, `disburse()`, `withdraw()`. `disburse()` takes **no caller
  authorization**: it checks that the window has elapsed, the balance covers
  the recipient set, and recipients are configured, and does not care who
  called it. `withdraw()` takes no destination parameter, so no call path sends
  funds anywhere but the configured owner. Emits `Disbursed` carrying the
  window index as a topic, so a verifier can answer "did window 7 fire?" from
  the chain alone.

  The event schema is declared with `#[contractevent]`, following `registry`,
  so it travels in the contract's own WASM spec and resolves through the same
  introspection path (`discoverContract` -> `parseContractSpec`) rather than
  needing a hand-maintained copy. A bundled well-known entry, which needs the
  deployed contract id, is added alongside the deployment.
- **`vault`** (`orbital-vault`) - **placeholder only, not a working contract.**
  Empty crate (`src/lib.rs` is a doc comment, no `#[contract]`) that exists so
  `tests/property.rs` and `tests/fuzz.rs` - `#[ignore]`d specifications of the
  invariants the real vault must uphold (issue #1069) - compile and are
  visible to `cargo test`. The actual vault contract is issue #1068 ("22.1
  Soroban vault contract with hard constraints"), open and unstarted; it
  replaces this crate entirely. See [`SECURITY.md`'s vault audit
  gate](../SECURITY.md#vault-audit-gate-phase-4-worker-layer) for the
  mainnet-deployment policy.

## Registry durability (entry TTL)

Soroban archives persistent storage entries once their TTL runs out. The
guarantee a publisher gets from `registry` is:

| | |
| --- | --- |
| TTL every write asks for | `max_entry_ttl`, currently **3,110,400 ledgers (~180 days)** |
| When the contract re-extends | Once an entry is within 30 days of expiring (`LIFETIME_THRESHOLD`) |
| What a read does | **Nothing** - reads never extend a TTL |
| Keeping an entry alive past 180 days | Call `touch`, e.g. via `packages/abi-registry/scripts/touch-registry.ts` |

`publish` bumps the spec entry and both index entries (`Latest`, `Versions`) to
the network maximum, so a spec published once and never republished is good for
about 180 days without anyone doing anything. Earlier versions of the contract
bumped by 30 days, which meant the canonical record of a contract's event shape
archived roughly a month after publication and the `RestoreFootprint` cost
landed on a downstream consumer.

`MAX_ENTRY_TTL` in `registry/src/lib.rs` must never exceed the network's own
`max_entry_ttl` - the host rejects an extension that asks for more. It is a
validator-votable setting, not a protocol constant, so re-read it before
raising the value:

```bash
curl -s -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLedgerEntries",
       "params":{"keys":["AAAACAAAAAo="]}}'
# STATE_ARCHIVAL config setting; max_entry_ttl is the first u32 of the payload.
# Both testnet and pubnet read 3,110,400 as of 2026-08-31.
```

### Why reads do not extend

Every resolver in this repo reads the registry through `simulateTransaction`
with an unfunded throwaway source (see
`packages/abi-registry/src/OnChainAbiRegistryClient.ts`). Extending a TTL is a
state change, so a read that extended would stop being a free simulation and
become a signed, fee-paying transaction for every consumer of every spec. The
durability budget is spent on the write path and on the keeper instead.

### Keeper

`packages/abi-registry/scripts/touch-registry.ts` calls the contract's
permissionless `touch(contract_id, publisher, versions)` entrypoint, which
re-extends the index entries plus up to `MAX_PAGE_SIZE` (25) spec versions per
call and returns how many entries it extended. It errors with `NothingToTouch`
rather than succeeding silently when the pair has no live entries.

**Cadence: run it at least every 90 days per `(contract_id, publisher)` pair** -
half the ~180-day window, so a single missed run is not an outage. Running it
more often is cheap: the contract only pays rent once an entry is inside the
30-day threshold, and is a no-op before that. Wiring it to a scheduled runner is
follow-up work; today it is a manual/cron-invocable script.

Note that `touch` cannot revive an entry that has *already* archived - that
needs a `RestoreFootprint` operation first.
`OnChainAbiRegistryClient` surfaces that case as a `RegistryEntryArchivedError`
(carrying the RPC's quoted restore fee) rather than as a `null` "never
published" result.

## Toolchain

Pinned via `rust-toolchain.toml`: an **exact** compiler version (currently
`1.97.1`), `wasm32v1-none` target, minimal profile.

The version is exact rather than `stable` because `deployed.testnet.json`
records the sha256 of the built WASM and CI re-derives it. A compiler upgrade
changes codegen, which changes the hash, which fails provenance on a source
tree nobody touched - that is exactly what happened when Rust 1.98.0 landed on
2026-08-18 against a deployment built on 1.97.1. Raising the pin is a
deliberate act: bump the channel, redeploy, commit both together.

**Note:** soroban-sdk 27's build script rejects the `wasm32-unknown-unknown`
target on Rust 1.82+ (reference-types/multi-value are enabled by default there
and unsupported by the Soroban environment) - use `wasm32v1-none` instead,
which has been available since Rust 1.84.

You'll also want the [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli)
(`stellar --version`) for deploying and interacting with contracts. Developed
against `stellar-cli 25.2.0` / `soroban-sdk 27.0.0`.

## Build & test

```sh
cd contracts
cargo test          # native unit tests (both contracts)
./build-wasm.sh     # production WASM build (pinned toolchain, paths remapped)
```

Build the WASM through `build-wasm.sh`, not `cargo build` directly. Its hash is
recorded in `deployed.testnet.json` and re-derived by CI, and the script is
what makes that hash reproducible: it asserts the pinned toolchain and passes
`--remap-path-prefix` for the cargo registry and the working tree. Without the
remapping, soroban-sdk's panic locations embed the builder's absolute paths, so
the same source produces different bytes under `/home/runner` than under your
home directory.

WASM artifacts land in `target/wasm32v1-none/release/orbital_abi_registry.wasm`
and `target/wasm32v1-none/release/orbital_demo_emitter.wasm`.

CI (`.github/workflows/contracts.yml`) runs both on every push/PR that touches
`contracts/**`.

## Deploy to testnet

```sh
stellar keys generate orbital-deployer --network testnet --fund   # one-time
./deploy/deploy_testnet.sh
```

This is a manual, one-time act - contracts are immutable once deployed, so
deployment is intentionally not part of any CI pipeline. The script builds
both contracts, deploys them, and writes `deployed.testnet.json` with the
resulting contract IDs. See that script's header comment and the maintainer
plan's "manual/gated steps" section for the secret-provisioning steps that
follow (GitHub repo secrets for the nightly integration test, Vercel env vars
for the demo's "Fire test event" route).

## Deployment Provenance & Reproducible Builds

`contracts/deployed.testnet.json` serves as the trust anchor for the whole registry: consumers resolve specs through the contract ID it names. To prevent this file from drifting from the source in `contracts/registry`, CI enforces deployment provenance on every PR and push.

The procedure:
1. CI builds the contracts through `build-wasm.sh`, which is what makes the output byte-for-byte identical across environments. Two inputs would otherwise leak in and both have to be controlled: the compiler version (pinned exactly in `rust-toolchain.toml`, and asserted by the script) and absolute build paths (normalised with `--remap-path-prefix`). The deploy script uses the same wrapper, so what gets deployed is what CI rebuilds.
2. The `wasmHash` values recorded in `deployed.testnet.json` are compared against the newly built WASM hashes. A mismatch fails the job with a diff of expected vs actual.
3. The deployed WASM bytecodes are fetched directly from the Stellar testnet and hashed to ensure they exactly match the local build.

Changing contract source without redeploying turns the CI job red. If you intentionally modify a contract, you must rebuild, redeploy (which updates `deployed.testnet.json`), and commit both the source changes and the updated JSON file together.

The job is path-filtered to `contracts/**`, so for three weeks nothing ran it and a stale deployment stayed invisible on `main` - it surfaced only when an unrelated PR happened to add a file under `contracts/`. It now also runs weekly (and on `workflow_dispatch`), so drift is caught without waiting for someone to touch a contract.
