#!/usr/bin/env bash
set -euo pipefail
# Thin wrapper - see deploy.sh for options and environment variables.
#
# This deploys to the Public Global Stellar Network with real XLM. deploy.sh
# will not proceed without an explicit confirmation (interactive prompt, or
# CONFIRM_MAINNET=yes).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh" mainnet "$@"
