#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
defaults=()
if [ -n "${STELLA_BACKEND_URL:-}" ]; then defaults+=("-DDEFAULT_BACKEND_URL=\"$STELLA_BACKEND_URL\""); fi
if [ -n "${STELLA_RELEASES_URL:-}" ]; then defaults+=("-DRELEASES_URL=\"${STELLA_RELEASES_URL%/}\""); fi
cc -O2 -g0 -Wall -Wextra -Wno-unused-parameter -Wno-deprecated-declarations \
  -DLAUNCHER_HTML="\"$(cd ../common && pwd)/launcher.html\"" \
  -DLAUNCHER_VERSION="${STELLA_LAUNCHER_VERSION:-0}" \
  ${defaults[@]+"${defaults[@]}"} \
  -o build/stella-launcher stella-launcher.c \
  $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1 libcrypto) -ldl -pthread
echo "Built $(pwd)/build/stella-launcher"
