#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release --arch arm64 --arch x86_64
bin_dir="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"

app="build/Stella.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/StellaLauncher" "$app/Contents/MacOS/StellaLauncher"
cp Resources/Info.plist "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${STELLA_LAUNCHER_VERSION:-0}" "$app/Contents/Info.plist"
if [ -n "${STELLA_BACKEND_URL:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :StellaBackendURL string $STELLA_BACKEND_URL" "$app/Contents/Info.plist"
fi
if [ -n "${STELLA_RELEASES_URL:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :StellaReleasesURL string ${STELLA_RELEASES_URL%/}" "$app/Contents/Info.plist"
fi
if [ -n "${STELLA_APPLE_TEAM_ID:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :StellaAppleTeamID string $STELLA_APPLE_TEAM_ID" "$app/Contents/Info.plist"
fi
cp ../common/launcher.html "$app/Contents/Resources/launcher.html"
icon="../../packages/desktop/build/icon.icns"
if [ -f "$icon" ]; then cp "$icon" "$app/Contents/Resources/Stella.icns"; fi

codesign --force --sign - --identifier com.stella.launcher "$app"
codesign --verify --strict --verbose=1 "$app"
lipo -info "$app/Contents/MacOS/StellaLauncher"
echo "Built $(pwd)/$app (version ${STELLA_LAUNCHER_VERSION:-0})"
