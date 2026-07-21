#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PLAYWRIGHT_DRIVER_PATH="$SCRIPT_DIR/playwright-driver"

exec "$SCRIPT_DIR/gamer-catch-rust" "$@"
