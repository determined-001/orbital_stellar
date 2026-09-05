#!/usr/bin/env bash
set -euo pipefail
# Thin wrapper - see deploy.sh for options and environment variables.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh" testnet "$@"
