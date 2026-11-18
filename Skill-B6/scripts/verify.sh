#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export B6_PYTHON="$ROOT_DIR/.venv/bin/python3"
export PYTHONUTF8=1
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPYCACHEPREFIX="$ROOT_DIR/workspace/cache/pycache"

if [ "$#" -gt 0 ]; then
  node "$ROOT_DIR/scripts/verify-all.mjs" "$@"
else
  node "$ROOT_DIR/scripts/verify-all.mjs" --max-workers 2
fi
