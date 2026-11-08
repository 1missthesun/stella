#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
defaults=()
if [ -n "${STELLA_BACKEND_URL:-}" ]; then defaults+=("-DDEFAULT_BACKEND_URL=\"$STELLA_BACKEND_URL\""); fi
if [ -n "${STELLA_RELEASES_URL:-}" ]; then defaults+=("-DRELEASES_URL=\"${STELLA_RELEASES_URL%/}\""); fi
if [ -n "${STELLA_LINUX_UPDATE_PUBLIC_KEY:-}" ]; then
  if ! [[ "$STELLA_LINUX_UPDATE_PUBLIC_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    echo "STELLA_LINUX_UPDATE_PUBLIC_KEY must be the base64 of a raw 32-byte Ed25519 key" >&2
    exit 1
  fi
  defaults+=("-DUPDATE_PUBLIC_KEY=\"$STELLA_LINUX_UPDATE_PUBLIC_KEY\"")
fi
cc -O2 -g0 -Wall -Wextra -Wno-unused-parameter -Wno-deprecated-declarations \
  -DLAUNCHER_HTML="\"$(cd ../common && pwd)/launcher.html\"" \
  -DLAUNCHER_VERSION="${STELLA_LAUNCHER_VERSION:-0}" \
  ${defaults[@]+"${defaults[@]}"} \
  -o build/stella-launcher stella-launcher.c \
  $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1 libcrypto) $(pkg-config --cflags libsecret-1) -ldl -pthread
echo "Built $(pwd)/build/stella-launcher"
