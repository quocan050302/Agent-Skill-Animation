#!/usr/bin/env bash
# Safe macOS/Linux setup script for Skill-Cartoon-Short (replaces unsafe /tmp operations in original setup.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"
if [ ! -d "node_modules/three" ] || [ ! -d "node_modules/playwright" ]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
fi

node tools/setup/hydrate.mjs "$@"
