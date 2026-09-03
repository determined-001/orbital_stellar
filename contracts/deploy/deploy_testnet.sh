#!/usr/bin/env bash
set -euo pipefail

# Deploys the registry and demo-emitter contracts to Stellar testnet.
#
# This is a MANUAL step: run it yourself with a funded testnet identity you
# control and are willing to hand this script access to. It is deliberately
# not wired into CI - contracts are immutable once deployed, so deployment is
# a one-time act, not a pipeline stage.
#
# Usage:
#   ./deploy_testnet.sh
#
# Requires:
#   - stellar-cli on PATH (`stellar --version`)
#   - A funded testnet identity. Create one if you don't have one yet:
#       stellar keys generate orbital-deployer --network testnet --fund
#     Or point DEPLOYER_IDENTITY at an existing identity name.
#
# Writes ../deployed.testnet.json with the resulting contract IDs - commit
# that file once you're happy with the deployment.

DEPLOYER_IDENTITY="${DEPLOYER_IDENTITY:-orbital-deployer}"
NETWORK="${NETWORK:-testnet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: stellar-cli not found on PATH. Install it first: https://developers.stellar.org/docs/tools/cli/install-cli" >&2
  exit 1
fi

if ! stellar keys address "$DEPLOYER_IDENTITY" >/dev/null 2>&1; then
  echo "error: identity '$DEPLOYER_IDENTITY' not found." >&2
  echo "Create one first, e.g.:" >&2
  echo "  stellar keys generate $DEPLOYER_IDENTITY --network $NETWORK --fund" >&2
  exit 1
fi

DEPLOYER_PUBLIC_KEY="$(stellar keys address "$DEPLOYER_IDENTITY")"

# Build through the shared wrapper, not cargo directly: it asserts the pinned
# toolchain and remaps build paths, which is what makes the hashes recorded
# below reproducible on CI and on anyone else's machine.
"$CONTRACTS_DIR/build-wasm.sh"

REGISTRY_WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/orbital_abi_registry.wasm"
DEMO_EMITTER_WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/orbital_demo_emitter.wasm"

echo "==> Deploying registry contract (deployer: $DEPLOYER_PUBLIC_KEY)"
REGISTRY_CONTRACT_ID="$(stellar contract deploy \
  --wasm "$REGISTRY_WASM" \
  --source-account "$DEPLOYER_IDENTITY" \
  --network "$NETWORK" \
  --alias orbital-registry)"
echo "    registry contract: $REGISTRY_CONTRACT_ID"

echo "==> Deploying demo-emitter contract"
DEMO_EMITTER_CONTRACT_ID="$(stellar contract deploy \
  --wasm "$DEMO_EMITTER_WASM" \
  --source-account "$DEPLOYER_IDENTITY" \
  --network "$NETWORK" \
  --alias orbital-demo-emitter)"
echo "    demo-emitter contract: $DEMO_EMITTER_CONTRACT_ID"

REGISTRY_WASM_HASH="$(sha256sum "$REGISTRY_WASM" | awk '{print $1}')"
DEMO_EMITTER_WASM_HASH="$(sha256sum "$DEMO_EMITTER_WASM" | awk '{print $1}')"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$CONTRACTS_DIR/deployed.testnet.json" <<EOF
{
  "network": "$NETWORK",
  "deployerPublicKey": "$DEPLOYER_PUBLIC_KEY",
  "deployedAt": "$DEPLOYED_AT",
  "contracts": {
    "registry": {
      "contractId": "$REGISTRY_CONTRACT_ID",
      "wasmHash": "$REGISTRY_WASM_HASH"
    },
    "demoEmitter": {
      "contractId": "$DEMO_EMITTER_CONTRACT_ID",
      "wasmHash": "$DEMO_EMITTER_WASM_HASH"
    }
  }
}
EOF

echo "==> Wrote $CONTRACTS_DIR/deployed.testnet.json"
echo
echo "Next steps (manual, see maintainer plan section 8):"
echo "  1. Add repo secrets SOROBAN_CONTRACT_ID=$REGISTRY_CONTRACT_ID and SOROBAN_INVOKER_SECRET (the deployer's secret key)."
echo "  2. Set DEMO_EMITTER_CONTRACT_ID=$DEMO_EMITTER_CONTRACT_ID and DEMO_EMITTER_SECRET as Vercel env vars for apps/web."
echo "  3. Run the well-known spec seeding script against the deployed registry."
