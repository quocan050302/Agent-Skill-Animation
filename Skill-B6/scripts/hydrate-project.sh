#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -gt 0 ]; then
  node "$ROOT_DIR/scripts/hydrate-project.mjs" "$@"
else
  node "$ROOT_DIR/scripts/hydrate-project.mjs" --all
fi
