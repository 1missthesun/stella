#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pins=$(node -e 'const p=require("./eas.json").build;console.log([...new Set(Object.values(p).map(b=>b.bun).filter(Boolean))].join(" "))')
local_bun=$(bun --version 2>/dev/null || echo "none")

if [[ -z "$pins" ]]; then
  echo "eas.json pins no bun version; EAS builders will pick their own and the fingerprint will drift." >&2
  exit 1
fi
if [[ "$pins" == *" "* ]]; then
  echo "eas.json pins different bun versions per profile ($pins); keep one." >&2
  exit 1
fi
if [[ "$local_bun" != "$pins" ]]; then
  stella_bun="$HOME/.local/share/stella/runtimes/bun-$pins/bun"
  echo "REFUSING: bun on PATH is $local_bun but eas.json pins $pins." >&2
  echo "The runtime fingerprint hashes bun's store paths, so a mismatch fails EAS in CONFIGURE_EXPO_UPDATES." >&2
  if [[ -x "$stella_bun" ]]; then
    echo "Fix: PATH=\"$(dirname "$stella_bun"):\$PATH\" bun install --frozen-lockfile, then rerun with that PATH." >&2
  else
    echo "Fix: install bun $pins (curl -fsSL https://bun.sh/install | bash -s bun-v$pins), run bun install --frozen-lockfile with it, then rerun." >&2
  fi
  exit 1
fi
echo "bun $local_bun matches eas.json."
