#!/usr/bin/env bash
# Builds Stella Rune for Android: the engine shared library (Rust, per ABI), the JS bundle (Bun)
# and the Kotlin app (Gradle), assembled into an APK.
#   scripts/build-android.sh [--abi x86_64|arm64-v8a|all] [--dist] [--skip-engine] [--skip-js]
#                            [--install] [--launch] [--probe]
# --install/--launch go to the one device adb sees (ANDROID_SERIAL picks one of several);
# --probe launches the first-light probe screen (STELLA_PHONE_UI=probe).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
source "$here/scripts/android-env.sh"
unset RUSTUP_TOOLCHAIN
abis=(x86_64 arm64-v8a); profile=release; skip_engine=0; skip_js=0; install=0; launch=0; ui=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --abi) [[ "$2" == all ]] && abis=(x86_64 arm64-v8a) || abis=("$2"); shift ;;
    --dist) profile=dist ;;
    --skip-engine) skip_engine=1 ;;
    --skip-js) skip_js=1 ;;
    --install) install=1 ;;
    --launch) install=1; launch=1 ;;
    --probe) ui=probe ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
target_dir="${STELLA_MOBILE_TARGET_DIR:-$HOME/Projects/.rune-target-android}"
out="$here/build/android"
mkdir -p "$out/jniLibs" "$out/assets"
strip="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"

for abi in "${abis[@]}"; do
  case "$abi" in
    x86_64) t=x86_64-linux-android ;;
    arm64-v8a) t=aarch64-linux-android ;;
    *) echo "unknown ABI $abi" >&2; exit 2 ;;
  esac
  if [[ $skip_engine == 0 ]]; then
    (cd "$here/engine" && CARGO_TARGET_DIR="$target_dir" cargo rustc --lib --crate-type cdylib --profile "$profile" --target "$t")
  fi
  mkdir -p "$out/jniLibs/$abi"
  "$strip" --strip-debug -o "$out/jniLibs/$abi/libstella_mobile_engine.so" "$target_dir/$t/$profile/libstella_mobile_engine.so"
done

if [[ $skip_js == 0 ]]; then
  backend="${STELLA_MOBILE_BACKEND:-$([[ $profile == dist ]] && echo prod || echo dev)}"
  bun "$here/js/build.ts" --out "$out/js" --backend "$backend"
fi
find "$out/assets" -mindepth 1 -delete 2>/dev/null || true
mkdir -p "$out/assets/fonts"
cp "$out/js/app.js" "$out/assets/app.js"
cp "$repo"/packages/desktop-rune/ui/theme/fonts/*.ttf "$out/assets/fonts/"
[[ -d "$out/js/assets" ]] && cp -R "$out/js/assets" "$out/assets/assets"
# Javet's V8 (15.8) reads its Intl data from a file: Chromium's ICU 78 data for Android, at the
# ICU revision V8 15.8.62.52 pins in its DEPS.
icu_rev=2a51536dfb3b448bdf3dae70c782ea2879c90904
icu="$out/cache/icudtl-$icu_rev.dat"
if [[ ! -s "$icu" ]]; then
  mkdir -p "$out/cache"
  curl -fsSL "https://chromium.googlesource.com/chromium/deps/icu.git/+/$icu_rev/android/icudtl.dat?format=TEXT" | base64 -d > "$icu.part"
  mv "$icu.part" "$icu"
fi
cp "$icu" "$out/assets/icudtl.dat"

task=assembleDebug; [[ $profile == dist ]] && task=assembleRelease
(cd "$here/android" && ./gradlew -q "$task")
variant=debug; [[ $profile == dist ]] && variant=release
apk="$here/android/app/build/outputs/apk/$variant/app-$variant.apk"
echo "built $apk ($(du -h "$apk" | cut -f1); js $(du -h "$out/assets/app.js" | cut -f1))"

if [[ $install == 1 ]]; then
  adb install -r -t "$apk" >/dev/null
  if [[ $launch == 1 ]]; then
    adb shell am force-stop com.stella.rune.dev
    extra=(); [[ -n "$ui" ]] && extra=(--es STELLA_PHONE_UI "$ui")
    adb shell am start -W -n com.stella.rune.dev/com.stella.rune.MainActivity "${extra[@]}" >/dev/null
  fi
fi
