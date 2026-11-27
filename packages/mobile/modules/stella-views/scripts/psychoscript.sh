#!/usr/bin/env bash
# The PsychoScript VM Stella Views run on (anomalyco/psychoscript, crate psychoscript-mobile, pinned to
# the rev the Rune desktop engine uses), built for this module into ios/vendor/ and android/vendor/ (gitignored):
#
#   scripts/psychoscript.sh ios        ios/vendor/PsychoScriptFFI.xcframework + ios/vendor/PsychoScript.swift
#   scripts/psychoscript.sh android    android/vendor/jniLibs/<abi>/libpsychoscript_mobile.so + android/vendor/kotlin/
#
# Builds are cached per rev in ~/Library/Caches/stella-psychoscript (XDG_CACHE_HOME on Linux), so stages
# and worktrees reuse them. Needs rustup; the crate's rust-toolchain.toml picks the toolchain. Android
# needs an NDK (ANDROID_NDK_HOME, or the newest under ANDROID_HOME/ndk) and cargo-ndk.
# Views need neither the widget encoder nor GPU canvases: built with --no-default-features.
set -euo pipefail

REV=e289f8ba62aa2b21c19a7ff20e8440c04d3f444c
platform="${1:?usage: psychoscript.sh ios|android}"
module="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
cache_root="${STELLA_PSYCHOSCRIPT_CACHE:-$([ "$(uname)" = Darwin ] && echo "$HOME/Library/Caches" || echo "${XDG_CACHE_HOME:-$HOME/.cache}")/stella-psychoscript}"
cache="$cache_root/$REV"
src="$cache_root/src"
out="$cache/$platform"
vendor="$module/$platform/vendor"

if [ -f "$vendor/REVISION" ] && [ "$(cat "$vendor/REVISION")" = "$REV" ]; then exit 0; fi

checkout() {
  if [ ! -d "$src/.git" ]; then
    git clone --filter=blob:none -q https://github.com/anomalyco/psychoscript "$src"
  fi
  if [ "$(git -C "$src" rev-parse HEAD 2>/dev/null)" != "$REV" ]; then
    git -C "$src" fetch -q origin "$REV" 2>/dev/null || git -C "$src" fetch -q origin
    git -C "$src" checkout -q --detach "$REV"
  fi
}

build_ios() {
  local root="$src/rust" targets=(aarch64-apple-ios aarch64-apple-ios-sim)
  cd "$root"
  rustup target add "${targets[@]}" >/dev/null
  export IPHONEOS_DEPLOYMENT_TARGET=15.1
  for triple in "${targets[@]}"; do
    cargo rustc -q -p psychoscript-mobile --lib --release --target "$triple" --crate-type staticlib --no-default-features
  done
  local gen="$cache/ios-gen"
  rm -rf "$gen" "$out"
  mkdir -p "$gen/include" "$out"
  local lib="target/aarch64-apple-ios/release/libpsychoscript_mobile.a"
  cargo run -q -p psychoscript-mobile --features cli --bin uniffi-bindgen-swift -- "$lib" "$gen" --swift-sources
  cargo run -q -p psychoscript-mobile --features cli --bin uniffi-bindgen-swift -- "$lib" "$gen/include" --headers --modulemap \
    --module-name PsychoScriptFFI --modulemap-filename module.modulemap
  cp "$gen"/*.swift "$out/PsychoScript.swift"
  local args=()
  for triple in "${targets[@]}"; do
    args+=(-library "target/$triple/release/libpsychoscript_mobile.a" -headers "$gen/include")
  done
  xcodebuild -create-xcframework "${args[@]}" -output "$out/PsychoScriptFFI.xcframework" >/dev/null
}

build_android() {
  local root="$src/rust"
  if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    [ -n "$sdk" ] || { echo "psychoscript.sh: set ANDROID_NDK_HOME or ANDROID_HOME" >&2; exit 1; }
    ANDROID_NDK_HOME="$(ls -d "$sdk"/ndk/*/ 2>/dev/null | while read -r d; do [ -d "$d/toolchains" ] && echo "${d%/}"; done | sort -V | tail -n 1)"
    export ANDROID_NDK_HOME
  fi
  command -v cargo-ndk >/dev/null || cargo install -q cargo-ndk
  cd "$root"
  local abis=(arm64-v8a:aarch64-linux-android armeabi-v7a:armv7-linux-androideabi x86_64:x86_64-linux-android)
  local triples=()
  for abi in "${abis[@]}"; do triples+=("${abi#*:}"); done
  rustup target add "${triples[@]}" >/dev/null
  rm -rf "$out"
  mkdir -p "$out/kotlin"
  # 16 KB pages (Android 15+), whatever the NDK's default.
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384"
  for abi in "${abis[@]}"; do
    local name="${abi%%:*}" triple="${abi#*:}"
    cargo ndk -t "$name" -P 24 rustc -q -p psychoscript-mobile --lib --release --crate-type cdylib --no-default-features
    mkdir -p "$out/jniLibs/$name"
    cp "target/$triple/release/libpsychoscript_mobile.so" "$out/jniLibs/$name/"
  done
  unset RUSTFLAGS
  cargo run -q -p psychoscript-mobile --features cli --bin uniffi-bindgen -- generate \
    --library "target/aarch64-linux-android/release/libpsychoscript_mobile.so" \
    --language kotlin --out-dir "$out/kotlin" --no-format
  local strip
  strip="$(ls "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/*/bin/llvm-strip | head -n 1)"
  for so in "$out"/jniLibs/*/libpsychoscript_mobile.so; do "$strip" --strip-unneeded "$so"; done
}

if [ ! -f "$out/REVISION" ]; then
  checkout
  case "$platform" in
    ios) build_ios ;;
    android) build_android ;;
    *) echo "psychoscript.sh: unknown platform $platform" >&2; exit 1 ;;
  esac
  echo "$REV" > "$out/REVISION"
fi
rm -rf "$vendor"
mkdir -p "$(dirname "$vendor")"
cp -R "$out" "$vendor"
