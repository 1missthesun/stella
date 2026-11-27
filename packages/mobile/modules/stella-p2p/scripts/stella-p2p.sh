#!/usr/bin/env bash
# The direct device link (crate stella-p2p in packages/desktop-rune/p2p, built with --features ffi),
# built for this module into ios/vendor/ and android/vendor/ (gitignored):
#
#   scripts/stella-p2p.sh ios        ios/vendor/StellaP2pFFI.xcframework (device + simulator staticlibs, C header)
#   scripts/stella-p2p.sh android    android/vendor/jniLibs/<abi>/libstella_p2p.so
#
# Builds are cached per crate source hash in ~/Library/Caches/stella-p2p (XDG_CACHE_HOME on Linux),
# so stages and worktrees reuse them. Needs rustup; the crate's rust-toolchain.toml picks the
# toolchain. Android needs an NDK (ANDROID_NDK_HOME, or the newest under ANDROID_HOME/ndk) and cargo-ndk.
set -euo pipefail

platform="${1:?usage: stella-p2p.sh ios|android}"
module="$(cd "$(dirname "$0")/.." && pwd)"
crate="$(cd "$module/../../../desktop-rune/p2p" && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
cache_root="${STELLA_P2P_CACHE:-$([ "$(uname)" = Darwin ] && echo "$HOME/Library/Caches" || echo "${XDG_CACHE_HOME:-$HOME/.cache}")/stella-p2p}"
rev="$(cd "$crate" && find Cargo.toml Cargo.lock rust-toolchain.toml src include -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-16)"
out="$cache_root/$rev/$platform"
vendor="$module/$platform/vendor"
export CARGO_TARGET_DIR="${STELLA_P2P_TARGET_DIR:-$cache_root/target}"

if [ -f "$vendor/REVISION" ] && [ "$(cat "$vendor/REVISION")" = "$rev" ]; then exit 0; fi

build_ios() {
  local targets=(aarch64-apple-ios aarch64-apple-ios-sim)
  cd "$crate"
  rustup target add "${targets[@]}" >/dev/null
  export IPHONEOS_DEPLOYMENT_TARGET=15.1
  for triple in "${targets[@]}"; do
    cargo rustc -q --lib --release --features ffi --target "$triple" --crate-type staticlib
  done
  rm -rf "$out"
  # The header sits in its own folder so its module map can't collide with another
  # xcframework's in the app's shared include directory.
  local headers="$cache_root/$rev/ios-headers"
  rm -rf "$headers"
  mkdir -p "$headers/StellaP2pFFI" "$out"
  cp include/stella_p2p.h "$headers/StellaP2pFFI/"
  cat > "$headers/StellaP2pFFI/module.modulemap" <<'MAP'
module StellaP2pFFI {
  header "stella_p2p.h"
  export *
}
MAP
  local args=()
  for triple in "${targets[@]}"; do
    args+=(-library "$CARGO_TARGET_DIR/$triple/release/libstella_p2p.a" -headers "$headers")
  done
  xcodebuild -create-xcframework "${args[@]}" -output "$out/StellaP2pFFI.xcframework" >/dev/null
}

build_android() {
  if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    [ -n "$sdk" ] || { echo "stella-p2p.sh: set ANDROID_NDK_HOME or ANDROID_HOME" >&2; exit 1; }
    ANDROID_NDK_HOME="$(ls -d "$sdk"/ndk/*/ 2>/dev/null | while read -r d; do [ -d "$d/toolchains" ] && echo "${d%/}"; done | sort -V | tail -n 1)"
    export ANDROID_NDK_HOME
  fi
  command -v cargo-ndk >/dev/null || cargo install -q cargo-ndk
  cd "$crate"
  local abis=(arm64-v8a:aarch64-linux-android armeabi-v7a:armv7-linux-androideabi x86_64:x86_64-linux-android x86:i686-linux-android)
  local triples=()
  for abi in "${abis[@]}"; do triples+=("${abi#*:}"); done
  rustup target add "${triples[@]}" >/dev/null
  rm -rf "$out"
  # 16 KB pages (Android 15+), whatever the NDK's default.
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384"
  for abi in "${abis[@]}"; do
    local name="${abi%%:*}" triple="${abi#*:}"
    cargo ndk -t "$name" -P 24 rustc -q --lib --release --features ffi --crate-type cdylib
    mkdir -p "$out/jniLibs/$name"
    cp "$CARGO_TARGET_DIR/$triple/release/libstella_p2p.so" "$out/jniLibs/$name/"
  done
}

if [ ! -d "$out" ] || [ -z "$(ls -A "$out" 2>/dev/null)" ]; then
  case "$platform" in
    ios) build_ios ;;
    android) build_android ;;
    *) echo "stella-p2p.sh: unknown platform $platform" >&2; exit 2 ;;
  esac
fi

rm -rf "$vendor"
mkdir -p "$vendor"
cp -R "$out"/. "$vendor"/
cp "$crate/include/stella_p2p.h" "$vendor/"
echo "$rev" > "$vendor/REVISION"
