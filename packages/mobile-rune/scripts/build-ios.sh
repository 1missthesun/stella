#!/usr/bin/env bash
# Builds Stella Rune for iOS: the engine static library (Rust), the JS bundle (Bun) and the
# Swift app, assembled into StellaRune.app (simulator by default).
#   scripts/build-ios.sh [--device] [--debug] [--skip-engine] [--skip-js] [--install <udid>] [--launch]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
sdk=iphonesimulator; rust_target=aarch64-apple-ios-sim; swift_target=arm64-apple-ios17.0-simulator
profile=release; skip_engine=0; skip_js=0; install=""; launch=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) sdk=iphoneos; rust_target=aarch64-apple-ios; swift_target=arm64-apple-ios17.0 ;;
    --dist) profile=dist ;;
    --skip-engine) skip_engine=1 ;;
    --skip-js) skip_js=1 ;;
    --install) install="$2"; shift ;;
    --launch) launch=1 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
target_dir="${STELLA_MOBILE_TARGET_DIR:-$HOME/projects/.rune-target-mobile}"
out="$here/build/$sdk"
app="$out/StellaRune.app"
mkdir -p "$out"

if [[ $skip_engine == 0 ]]; then
  (cd "$here/engine" && IPHONEOS_DEPLOYMENT_TARGET=17.0 CARGO_TARGET_DIR="$target_dir" cargo build --profile "$profile" --target "$rust_target")
fi
lib="$target_dir/$rust_target/$profile/libstella_mobile_engine.a"

if [[ $skip_js == 0 ]]; then
  # Dev builds talk to the dev backend; --dist builds to prod (STELLA_MOBILE_BACKEND overrides).
  backend="${STELLA_MOBILE_BACKEND:-$([[ $profile == dist ]] && echo prod || echo dev)}"
  bun "$here/js/build.ts" --out "$out/js" --backend "$backend"
fi

rm -rf "$app"
mkdir -p "$app/fonts"
sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
swift_defines=(); [[ $profile == dist ]] || swift_defines=(-D STELLA_DEV)
xcrun --sdk "$sdk" swiftc -O "${swift_defines[@]}" -target "$swift_target" -sdk "$sdk_path" \
  -import-objc-header "$here/engine/include/stella_mobile_engine.h" \
  "$here"/ios/StellaRune/*.swift \
  "$lib" \
  -Xlinker -dead_strip \
  -framework UIKit -framework Metal -framework QuartzCore -framework JavaScriptCore -framework CoreText \
  -framework CoreGraphics -framework CoreVideo -framework CoreMedia -framework AVFoundation -framework IOSurface \
  -framework Security -framework SafariServices -framework PhotosUI -framework Photos -framework UniformTypeIdentifiers -framework UserNotifications -framework AudioToolbox \
  -framework CoreFoundation -framework Foundation -framework SystemConfiguration -lc++ -liconv \
  -o "$app/StellaRune"
cp "$here/ios/StellaRune/Info.plist" "$app/Info.plist"
if [[ $sdk == iphoneos ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleSupportedPlatforms:0 iPhoneOS" "$app/Info.plist"
fi
cp "$out/js/app.js" "$app/app.js"
cp "$repo"/packages/desktop-rune/ui/theme/fonts/*.ttf "$app/fonts/"
[[ -d "$out/js/assets" ]] && cp -R "$out/js/assets" "$app/assets"
codesign --force --sign - --timestamp=none "$app" >/dev/null
echo "built $app ($(du -sh "$app" | cut -f1); binary $(du -h "$app/StellaRune" | cut -f1); js $(du -h "$app/app.js" | cut -f1))"

if [[ -n "$install" ]]; then
  xcrun simctl install "$install" "$app"
  if [[ $launch == 1 ]]; then
    xcrun simctl terminate "$install" com.stella.rune.dev >/dev/null 2>&1 || true
    xcrun simctl launch "$install" com.stella.rune.dev
  fi
fi
