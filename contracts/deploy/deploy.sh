#!/usr/bin/env bash
set -euo pipefail

# Deploys Orbital's Soroban contracts to a Stellar network and records the
# result in ../deployed.<network>.json.
#
# This is a MANUAL step: run it yourself with a funded identity you control and
# are willing to hand this script access to. It is deliberately not wired into
# CI - contracts are immutable once deployed, so deployment is a one-time act,
# not a pipeline stage.
#
# Usage:
#   ./deploy.sh testnet
#   ./deploy.sh mainnet
#
# Or through the thin wrappers, which is what the docs reference:
#   ./deploy_testnet.sh
#   ./deploy_mainnet.sh
#
# Environment:
#   DEPLOYER_IDENTITY   stellar-cli identity name    (default: orbital-deployer)
#   CONTRACTS           space-separated contract set (default: per network, see below)
#   RPC_URL             override the CLI's built-in network endpoint
#   NETWORK_PASSPHRASE  required if RPC_URL is set
#   CONFIRM_MAINNET     must be "yes" to deploy to mainnet non-interactively
#   ALLOW_REDEPLOY      must be "yes" to overwrite an already-populated manifest
#
# Requires stellar-cli on PATH (`stellar --version`).

NETWORK="${1:-}"
if [ -z "$NETWORK" ]; then
  echo "usage: $0 <testnet|mainnet>" >&2
  exit 2
fi

case "$NETWORK" in
  testnet|mainnet) ;;
  *)
    echo "error: unsupported network '$NETWORK'. Use 'testnet' or 'mainnet'." >&2
    exit 2
    ;;
esac

DEPLOYER_IDENTITY="${DEPLOYER_IDENTITY:-orbital-deployer}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$CONTRACTS_DIR/deployed.$NETWORK.json"

# Which contracts belong on which network.
#
# demo-emitter is a testnet fixture: it exists so the docs, the starters and
# the e2e tests have a contract that emits on demand. Putting it on the public
# network would spend real XLM to publish a toy, so mainnet defaults to the two
# contracts that carry real function - the registry and payroll. Override with
# CONTRACTS if you genuinely want a different set.
if [ "$NETWORK" = "mainnet" ]; then
  DEFAULT_CONTRACTS="registry payroll"
else
  DEFAULT_CONTRACTS="registry demoEmitter payroll"
fi
CONTRACTS="${CONTRACTS:-$DEFAULT_CONTRACTS}"

# contract key -> wasm basename, alias
wasm_for() {
  case "$1" in
    registry)    echo "orbital_abi_registry" ;;
    demoEmitter) echo "orbital_demo_emitter" ;;
    payroll)     echo "orbital_payroll" ;;
    vault)       echo "orbital_vault" ;;
    *) echo "error: unknown contract key '$1'" >&2; return 1 ;;
  esac
}

alias_for() {
  case "$1" in
    registry)    echo "orbital-registry" ;;
    demoEmitter) echo "orbital-demo-emitter" ;;
    payroll)     echo "orbital-payroll" ;;
    vault)       echo "orbital-vault" ;;
    *) echo "error: unknown contract key '$1'" >&2; return 1 ;;
  esac
}

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: stellar-cli not found on PATH. Install it first: https://developers.stellar.org/docs/tools/cli/install-cli" >&2
  exit 1
fi

if ! stellar keys address "$DEPLOYER_IDENTITY" >/dev/null 2>&1; then
  echo "error: identity '$DEPLOYER_IDENTITY' not found." >&2
  echo "Create one first, e.g.:" >&2
  if [ "$NETWORK" = "testnet" ]; then
    echo "  stellar keys generate $DEPLOYER_IDENTITY --network testnet --fund" >&2
  else
    echo "  stellar keys add $DEPLOYER_IDENTITY   # then fund it with real XLM" >&2
  fi
  exit 1
fi

DEPLOYER_PUBLIC_KEY="$(stellar keys address "$DEPLOYER_IDENTITY")"

# Network flags. The CLI knows testnet and mainnet by name; RPC_URL is the
# escape hatch for a private endpoint or an older CLI that lacks the alias.
if [ -n "${RPC_URL:-}" ]; then
  if [ -z "${NETWORK_PASSPHRASE:-}" ]; then
    echo "error: RPC_URL is set but NETWORK_PASSPHRASE is not. Both are required together." >&2
    exit 2
  fi
  NETWORK_ARGS=(--rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE")
else
  NETWORK_ARGS=(--network "$NETWORK")
fi

# ---------------------------------------------------------------------------
# Guard rails. Both of these protect against an irreversible act: a deployed
# contract cannot be deleted, and a redeploy does not migrate the old one's
# state - it publishes a second contract and orphans the first.
# ---------------------------------------------------------------------------

if [ -f "$MANIFEST" ] && \
   ! jq -e '[.contracts[] | select((.contractId | startswith("<")) or (.wasmHash == ""))] | length > 0' \
        "$MANIFEST" >/dev/null 2>&1; then
  if [ "${ALLOW_REDEPLOY:-}" != "yes" ]; then
    echo "error: $MANIFEST already records a live deployment." >&2
    echo >&2
    jq -r '.contracts | to_entries[] | "  \(.key): \(.value.contractId)"' "$MANIFEST" >&2
    echo >&2
    echo "Deploying again publishes NEW contracts at NEW ids. It does not upgrade" >&2
    echo "or migrate the ones above - their state stays where it is, and anything" >&2
    echo "already pointing at those ids keeps pointing at them." >&2
    echo >&2
    echo "Set ALLOW_REDEPLOY=yes if that is genuinely what you want." >&2
    exit 1
  fi
  echo "!! ALLOW_REDEPLOY=yes - overwriting an existing deployment record."
fi

if [ "$NETWORK" = "mainnet" ]; then
  echo
  echo "=============================================================="
  echo " MAINNET DEPLOYMENT"
  echo "=============================================================="
  echo "  Network:   Public Global Stellar Network"
  echo "  Deployer:  $DEPLOYER_PUBLIC_KEY"
  echo "  Contracts: $CONTRACTS"
  echo
  echo "  This spends real XLM and publishes immutable contracts that"
  echo "  cannot be deleted or edited afterwards."
  echo "=============================================================="
  echo
  if [ "${CONFIRM_MAINNET:-}" = "yes" ]; then
    echo "CONFIRM_MAINNET=yes - proceeding without prompting."
  elif [ -t 0 ]; then
    read -r -p "Type 'deploy to mainnet' to continue: " reply
    if [ "$reply" != "deploy to mainnet" ]; then
      echo "Aborted." >&2
      exit 1
    fi
  else
    echo "error: refusing to deploy to mainnet from a non-interactive shell." >&2
    echo "Set CONFIRM_MAINNET=yes if you are sure." >&2
    exit 1
  fi
fi

# Build through the shared wrapper, not cargo directly: it asserts the pinned
# toolchain and remaps build paths, which is what makes the hashes recorded
# below reproducible on CI and on anyone else's machine.
"$CONTRACTS_DIR/build-wasm.sh"

declare -A CONTRACT_IDS=()
declare -A WASM_HASHES=()

for key in $CONTRACTS; do
  wasm_name="$(wasm_for "$key")"
  wasm_path="$CONTRACTS_DIR/target/wasm32v1-none/release/$wasm_name.wasm"

  if [ ! -f "$wasm_path" ]; then
    echo "error: expected build output missing: $wasm_path" >&2
    exit 1
  fi

  echo "==> Deploying $key (deployer: $DEPLOYER_PUBLIC_KEY, network: $NETWORK)"
  id="$(stellar contract deploy \
    --wasm "$wasm_path" \
    --source-account "$DEPLOYER_IDENTITY" \
    "${NETWORK_ARGS[@]}" \
    --alias "$(alias_for "$key")")"
  echo "    $key contract: $id"

  CONTRACT_IDS["$key"]="$id"
  WASM_HASHES["$key"]="$(sha256sum "$wasm_path" | awk '{print $1}')"
done

DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the manifest with jq so the JSON is valid whatever CONTRACTS held.
contracts_json="{}"
for key in $CONTRACTS; do
  contracts_json="$(jq -n \
    --argjson acc "$contracts_json" \
    --arg k "$key" \
    --arg id "${CONTRACT_IDS[$key]}" \
    --arg hash "${WASM_HASHES[$key]}" \
    '$acc + {($k): {contractId: $id, wasmHash: $hash}}')"
done

jq -n \
  --arg network "$NETWORK" \
  --arg deployer "$DEPLOYER_PUBLIC_KEY" \
  --arg at "$DEPLOYED_AT" \
  --argjson contracts "$contracts_json" \
  '{network: $network, deployerPublicKey: $deployer, deployedAt: $at, contracts: $contracts}' \
  > "$MANIFEST"

echo "==> Wrote $MANIFEST"
echo
echo "Next steps (manual):"
echo "  1. Commit $MANIFEST - CI's verify-provenance job reads it to check that"
echo "     what is on chain matches what this repo builds."
if [ -n "${CONTRACT_IDS[registry]:-}" ]; then
  echo "  2. Seed the well-known specs against registry ${CONTRACT_IDS[registry]}."
fi
if [ -n "${CONTRACT_IDS[payroll]:-}" ]; then
  echo "  3. Register the payroll Disbursed event schema against ${CONTRACT_IDS[payroll]}"
  echo "     so it resolves through AbiRegistryClient (see contracts/README.md)."
fi
