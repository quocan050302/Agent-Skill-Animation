#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export B6_PYTHON="$ROOT_DIR/.venv/bin/python3"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPYCACHEPREFIX="$ROOT_DIR/workspace/cache/pycache"
SKILL_DIR="$ROOT_DIR/vendor/stickman-video-director/skills/directing-stickman-videos"

(cd "$SKILL_DIR" && node scripts/autopilot.mjs doctor --style B6 --python "$B6_PYTHON" && node scripts/b6-dynamic-meme.mjs check-pack)
npm run build
npm --workspace=app/server run test
npm --workspace=app/frontend run test:e2e
