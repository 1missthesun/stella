#!/usr/bin/env bash
# Screenshots one reference page (desktop-ui's real components in headless Chromium) to a PNG.
# Usage: scripts/ref-shot.sh <page> <theme> <out.png>   (needs `vite --config reference/vite.config.ts` running)
set -euo pipefail
PORT="${PORT:-57390}"
PROFILE="${PROFILE:-$(mktemp -d)}"
timeout 60 chromium --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,820 \
  --virtual-time-budget="${BUDGET:-8000}" --enable-logging=stderr --v=0 \
  --screenshot="$3" "http://127.0.0.1:$PORT/?page=$1&theme=$2" 2>"${LOG:-/dev/null}"
