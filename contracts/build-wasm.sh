#!/usr/bin/env bash
#
# The one way to build the contract WASM.
#
# `deployed.testnet.json` records the sha256 of these artifacts, CI rebuilds
# them and compares, and the on-chain code is compared against both. That only
# means anything if the same source produces the same bytes on every machine.
# Two things break that by default, and this script fixes both:
#
#   1. The compiler version. Pinned in `rust-toolchain.toml`; asserted below so
#      a mismatch fails here rather than as an unexplained hash diff later.
#
#   2. Absolute build paths. soroban-sdk's panic locations embed the path of
#      the crate source, so a build under /home/runner and the same build under
#      /home/alice differ byte-for-byte. `--remap-path-prefix` normalises the
#      two prefixes that vary - the cargo registry and the working tree - onto
#      fixed names, so the output no longer depends on where it was built.
#
# Both CI and deploy_testnet.sh call this. Do not call `cargo build` directly
# for anything whose hash is recorded.
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CONTRACTS_DIR"

EXPECTED_TOOLCHAIN="$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)"
ACTUAL_TOOLCHAIN="$(rustc --version | awk '{print $2}')"

if [ "$ACTUAL_TOOLCHAIN" != "$EXPECTED_TOOLCHAIN" ]; then
  echo "ERROR: toolchain mismatch - rust-toolchain.toml pins ${EXPECTED_TOOLCHAIN}, building with ${ACTUAL_TOOLCHAIN}." >&2
  echo "       The recorded WASM hashes are only reproducible on the pinned compiler." >&2
  echo "       Install it (rustup toolchain install ${EXPECTED_TOOLCHAIN}) or, to move" >&2
  echo "       the pin deliberately, bump rust-toolchain.toml and redeploy." >&2
  exit 1
fi

CARGO_REGISTRY_HOME="${CARGO_HOME:-$HOME/.cargo}"

# Keep these two prefixes in sync with anything that verifies a hash: change
# them and every recorded hash changes with them.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=${CARGO_REGISTRY_HOME}=/cargo --remap-path-prefix=${CONTRACTS_DIR}=/build"

echo "==> Building contracts (release, wasm32v1-none, rustc ${ACTUAL_TOOLCHAIN}, paths remapped)"
# --locked: the recorded hashes are only meaningful if the dependency graph is
# exactly the one in Cargo.lock. Without it cargo may update the index and
# silently resolve something else, which changes the bytes.
cargo build --locked --release --target wasm32v1-none

# Every contract the workspace builds, not a hand-picked subset: CI's
# verify-provenance iterates whatever a deployment manifest names, so a
# contract missing from this summary is one whose hash nobody sees until a
# deployment disagrees with it. payroll was deployed and unhashed here for
# weeks precisely because it was not on the list.
for wasm in target/wasm32v1-none/release/*.wasm; do
  [ -e "$wasm" ] || continue
  printf '    %s  %s\n' "$(sha256sum "$wasm" | awk '{print $1}')" "$(basename "$wasm")"
done
