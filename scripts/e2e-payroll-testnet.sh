#!/usr/bin/env bash
set -euo pipefail

# End-to-end proof, on live testnet, of the worker layer's first rule:
# **the trigger is not the custodian** (docs/design/workers.md).
#
# It configures a payroll, funds it, waits for the window to elapse, and then
# fires `disburse()` from a freshly-generated account that has never been told
# anything about the payroll and holds no authority over it. The payment
# executes. That is the whole thesis, demonstrated against a real network
# rather than asserted in a unit test:
#
#   - the caller controls only *when* a predetermined payment happens
#   - funds move only to recipients fixed at configure time
#   - a worker vanishing means "late", never "stolen"
#
# It deploys its OWN payroll instance rather than using the one in
# deployed.testnet.json, because `configure()` may only ever run once per
# contract and the canonical instance should not be consumed by a test.
#
# Self-contained: every identity is generated and friendbot-funded here, so it
# needs no pre-existing key and spends nothing real.
#
# Usage:
#   ./scripts/e2e-payroll-testnet.sh
#
# Requires stellar-cli on PATH and a built payroll WASM (the script builds it).

NETWORK=testnet
PERIOD=60                     # seconds; short so the test does not idle for long
PAY_1=50000000                # 5 XLM in stroops
PAY_2=30000000                # 3 XLM in stroops
FUNDING=200000000             # 20 XLM, comfortably above one window

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%s)"
EMPLOYER="e2e-employer-$STAMP"
STRANGER="e2e-stranger-$STAMP"
ALICE="e2e-alice-$STAMP"
BOB="e2e-bob-$STAMP"

command -v stellar >/dev/null || { echo "error: stellar-cli not on PATH" >&2; exit 1; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Generating and funding four throwaway identities"
for id in "$EMPLOYER" "$STRANGER" "$ALICE" "$BOB"; do
  stellar keys generate "$id" --network "$NETWORK" --fund >/dev/null 2>&1
  printf '    %-22s %s\n' "$id" "$(stellar keys address "$id")"
done

EMPLOYER_ADDR="$(stellar keys address "$EMPLOYER")"
STRANGER_ADDR="$(stellar keys address "$STRANGER")"
ALICE_ADDR="$(stellar keys address "$ALICE")"
BOB_ADDR="$(stellar keys address "$BOB")"

# The native XLM Stellar Asset Contract. Native is used deliberately: it needs
# no trustline, so recipients can be plain funded accounts and the test stays
# about payroll rather than about asset setup.
say "Resolving the native XLM Stellar Asset Contract"
TOKEN="$(stellar contract id asset --asset native --network "$NETWORK")"
echo "    token: $TOKEN"

say "Building and deploying a dedicated payroll instance"
"$ROOT/contracts/build-wasm.sh" >/dev/null
PAYROLL="$(stellar contract deploy \
  --wasm "$ROOT/contracts/target/wasm32v1-none/release/orbital_payroll.wasm" \
  --source-account "$EMPLOYER" --network "$NETWORK" 2>/dev/null | tail -1)"
echo "    payroll: $PAYROLL"

say "Configuring: alice $((PAY_1/10000000)) XLM, bob $((PAY_2/10000000)) XLM, every ${PERIOD}s"
stellar contract invoke --id "$PAYROLL" --source-account "$EMPLOYER" --network "$NETWORK" -- \
  configure \
  --owner "$EMPLOYER_ADDR" \
  --token "$TOKEN" \
  --period "$PERIOD" \
  --recipients "[{\"to\":\"$ALICE_ADDR\",\"amount\":\"$PAY_1\"},{\"to\":\"$BOB_ADDR\",\"amount\":\"$PAY_2\"}]" \
  >/dev/null
echo "    configured"

say "Funding the payroll with $((FUNDING/10000000)) XLM"
stellar contract invoke --id "$PAYROLL" --source-account "$EMPLOYER" --network "$NETWORK" -- \
  fund --from "$EMPLOYER_ADDR" --amount "$FUNDING" >/dev/null
echo "    funded"

balance_of() {
  stellar contract invoke --id "$TOKEN" --source-account "$EMPLOYER" --network "$NETWORK" \
    --send=no -- balance --id "$1" 2>/dev/null | tr -d '"'
}

ALICE_BEFORE="$(balance_of "$ALICE_ADDR")"
BOB_BEFORE="$(balance_of "$BOB_ADDR")"
echo "    alice before: $ALICE_BEFORE"
echo "    bob   before: $BOB_BEFORE"

say "Confirming disburse() is refused before the window elapses"
if stellar contract invoke --id "$PAYROLL" --source-account "$STRANGER" --network "$NETWORK" -- \
     disburse >/dev/null 2>&1; then
  echo "    UNEXPECTED: disburse succeeded before it was due" >&2
  exit 1
fi
echo "    refused, as it should be (NotDue)"

DUE_AT="$(stellar contract invoke --id "$PAYROLL" --source-account "$EMPLOYER" --network "$NETWORK" \
  --send=no -- next_due_at 2>/dev/null | tr -d '"')"
NOW="$(date +%s)"
WAIT=$(( DUE_AT - NOW + 5 ))
[ "$WAIT" -lt 0 ] && WAIT=0
say "Waiting ${WAIT}s for the window to become payable"
sleep "$WAIT"

# The point of the whole exercise. This account was created minutes ago, holds
# no role in the payroll, was never granted anything, and is not the owner.
say "Firing disburse() from a STRANGER ($STRANGER_ADDR)"
TX="$(stellar contract invoke --id "$PAYROLL" --source-account "$STRANGER" --network "$NETWORK" -- \
  disburse 2>&1 | tail -1)"
echo "    disburse returned window: $TX"

ALICE_AFTER="$(balance_of "$ALICE_ADDR")"
BOB_AFTER="$(balance_of "$BOB_ADDR")"

say "Result"
printf '    alice  %s -> %s  (delta %s)\n' "$ALICE_BEFORE" "$ALICE_AFTER" "$((ALICE_AFTER - ALICE_BEFORE))"
printf '    bob    %s -> %s  (delta %s)\n' "$BOB_BEFORE" "$BOB_AFTER" "$((BOB_AFTER - BOB_BEFORE))"

FAIL=0
[ "$((ALICE_AFTER - ALICE_BEFORE))" -eq "$PAY_1" ] || { echo "    FAIL: alice delta != $PAY_1" >&2; FAIL=1; }
[ "$((BOB_AFTER - BOB_BEFORE))" -eq "$PAY_2" ] || { echo "    FAIL: bob delta != $PAY_2" >&2; FAIL=1; }
[ "$FAIL" -eq 0 ] || exit 1

cat <<EOF

    PASS - a stranger triggered a payment it had no authority over.

    Recipients were fixed at configure time and the caller could not influence
    them. The only thing the stranger controlled was *when*. If every Orbital
    worker disappeared, this payroll runs late; it does not lose funds.

    payroll:  $PAYROLL
    explorer: https://stellar.expert/explorer/testnet/contract/$PAYROLL
EOF
