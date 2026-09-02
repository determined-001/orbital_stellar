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
