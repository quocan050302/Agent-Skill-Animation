#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== B6 Local Studio Setup (Unix) ==="
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js >= 20 required" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe required" >&2; exit 1; }

LOCK_FILE="$ROOT_DIR/upstream-lock.json"
REPO_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).repoUrl)" "$LOCK_FILE")
LOCK_BRANCH=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).branch)" "$LOCK_FILE")
LOCK_SHA=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).commitSha)" "$LOCK_FILE")
SKILL_SUBDIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).skillSubdir)" "$LOCK_FILE")

VENDOR_DIR="$ROOT_DIR/vendor/stickman-video-director"
SKILL_DIR="$VENDOR_DIR/$SKILL_SUBDIR"

if [ ! -d "$VENDOR_DIR/.git" ]; then
  mkdir -p "$(dirname "$VENDOR_DIR")"
  git clone --no-checkout "$REPO_URL" "$VENDOR_DIR"
fi

(cd "$VENDOR_DIR" && git config core.autocrlf false && git config core.eol lf && git fetch origin "$LOCK_SHA" && git checkout -B "$LOCK_BRANCH" "$LOCK_SHA" && [ "$(git rev-parse HEAD)" = "$LOCK_SHA" ])

(cd "$SKILL_DIR" && npm ci)

if [ ! -x "$ROOT_DIR/.venv/bin/python3" ]; then
  python3 -m venv "$ROOT_DIR/.venv"
fi
"$ROOT_DIR/.venv/bin/python3" -m pip install --upgrade pip
"$ROOT_DIR/.venv/bin/python3" -m pip install -r "$SKILL_DIR/assets/b6/hong-kong-v90/requirements.txt"

npm install
npm run build

export B6_PYTHON="$ROOT_DIR/.venv/bin/python3"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPYCACHEPREFIX="$ROOT_DIR/workspace/cache/pycache"
(cd "$SKILL_DIR" && node scripts/autopilot.mjs doctor --style B6 --python "$B6_PYTHON" && node scripts/b6-dynamic-meme.mjs check-pack)
node "$ROOT_DIR/scripts/hydrate-project.mjs" --all
echo "Setup completed!"
