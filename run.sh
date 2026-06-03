#!/usr/bin/env bash
#
# run.sh — launch Morari Translate from source (no .dmg, no code signing,
# no Gatekeeper). Use this to confirm the app works before packaging an
# installer. Safe to re-run; each step is skipped if already done.
#
#   ./run.sh
#
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required and not on your PATH. Install it from https://nodejs.org and re-run." >&2
  exit 1
fi
echo "==> Node $(node -v)"

# 1. Make sure the worker submodule is checked out (you own morari-translate,
#    so your normal git credentials are used — no PAT needed locally).
if [ ! -f electron/worker/package.json ]; then
  echo "==> Fetching worker submodule (electron/worker)…"
  git submodule update --init --recursive
fi
if [ ! -f electron/worker/package.json ] || [ ! -f electron/worker/src/index.js ]; then
  echo "ERROR: electron/worker looks empty (need package.json + src/index.js)." >&2
  echo "       Run: git submodule update --init --recursive" >&2
  exit 1
fi

# 2. App (Electron shell) dependencies.
if [ ! -d node_modules ]; then
  echo "==> Installing app dependencies…"
  npm install
fi

# 3. Worker dependencies (the app would otherwise install these on first launch).
if [ ! -d electron/worker/node_modules ]; then
  echo "==> Installing worker dependencies (one-time)…"
  ( cd electron/worker && npm install )
fi

# 4. Build the renderer bundle and launch Electron in dev mode.
echo "==> Launching Morari Translate (dev)…"
npm run dev
