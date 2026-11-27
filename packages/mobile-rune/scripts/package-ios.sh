#!/usr/bin/env bash
# Packages Stella Rune for the App Store / TestFlight: a prod (--dist) device build, its app icon
# compiled into an asset catalog, the Info.plist an App Store upload needs, signed with an
# App Store provisioning profile and zipped into an .ipa. Optionally uploads it.
#   scripts/package-ios.sh --profile <file.mobileprovision> [--identity <name|sha1>] [--keychain <path>]
#                          [--bundle-id com.stella.rune] [--version 0.1.0] [--build <n>]
#                          [--skip-engine] [--skip-js] [--upload --api-key <id> --api-issuer <id> --p8 <file>]
# The bundle id must match the profile's. Of ios/StellaRune/StellaRune.entitlements (push, Sign in
# with Apple) the build signs in what the profile grants, with the profile's values, so enabling a
# capability on the App ID and making a new profile is all it takes to turn one on.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
profile=""; identity="Apple Distribution"; keychain=""; bundle_id="com.stella.rune"
version="0.1.0"; build="$(date -u +%y%m%d%H%M)"; build_args=(); upload=0; api_key=""; api_issuer=""; p8=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) profile="$2"; shift ;;
    --identity) identity="$2"; shift ;;
    --keychain) keychain="$2"; shift ;;
    --bundle-id) bundle_id="$2"; shift ;;
    --version) version="$2"; shift ;;
    --build) build="$2"; shift ;;
    --skip-engine|--skip-js) build_args+=("$1") ;;
    --upload) upload=1 ;;
    --api-key) api_key="$2"; shift ;;
    --api-issuer) api_issuer="$2"; shift ;;
    --p8) p8="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[[ -f "$profile" ]] || { echo "--profile <file.mobileprovision> is required" >&2; exit 2; }
if [[ $upload == 1 && ( -z "$api_key" || -z "$api_issuer" || ! -f "$p8" ) ]]; then
  echo "--upload needs --api-key, --api-issuer and --p8" >&2; exit 2
fi

"$here/scripts/build-ios.sh" --device --dist ${build_args[@]+"${build_args[@]}"}

out="$here/build/iphoneos"
app="$out/StellaRune.app"
work="$out/package"
rm -rf "$work"; mkdir -p "$work"
plist="$app/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$2"; }

security cms -D -i "$profile" > "$work/profile.plist"
profile_app_id="$(pb "Print :Entitlements:application-identifier" "$work/profile.plist")"
team="$(pb "Print :Entitlements:com.apple.developer.team-identifier" "$work/profile.plist")"
[[ "$profile_app_id" == "$team.$bundle_id" ]] || { echo "profile is for $profile_app_id, not $team.$bundle_id" >&2; exit 1; }

# App icon: one 1024 px image; actool renders every size and writes CFBundleIcons.
catalog="$work/Assets.xcassets"
mkdir -p "$catalog/AppIcon.appiconset"
cp "$here/ios/StellaRune/AppIcon.png" "$catalog/AppIcon.appiconset/AppIcon.png"
printf '{"info":{"author":"xcode","version":1}}\n' > "$catalog/Contents.json"
printf '{"images":[{"filename":"AppIcon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}\n' \
  > "$catalog/AppIcon.appiconset/Contents.json"
xcrun actool "$catalog" --compile "$app" --platform iphoneos --minimum-deployment-target 17.0 \
  --target-device iphone --target-device ipad --app-icon AppIcon \
  --output-partial-info-plist "$work/icons.plist" --output-format human-readable-text >/dev/null

xcode_version="$(xcodebuild -version | awk 'NR==1 {print $2}')"
IFS=. read -r xc_major xc_minor xc_patch <<< "$xcode_version"
sdk_version="$(xcrun --sdk iphoneos --show-sdk-version)"
sdk_build="$(xcrun --sdk iphoneos --show-sdk-build-version)"
set_key() { pb "Delete :$1" "$plist" >/dev/null 2>&1 || true; pb "Add :$1 $2 $3" "$plist"; }
set_key CFBundleIdentifier string "$bundle_id"
set_key CFBundleShortVersionString string "$version"
set_key CFBundleVersion string "$build"
set_key UIRequiresFullScreen bool true
set_key DTPlatformName string iphoneos
set_key DTPlatformVersion string "$sdk_version"
set_key DTPlatformBuild string "$sdk_build"
set_key DTSDKName string "iphoneos$sdk_version"
set_key DTSDKBuild string "$sdk_build"
set_key DTXcode string "$(printf '%d%d%d' "$xc_major" "${xc_minor:-0}" "${xc_patch:-0}")"
set_key DTXcodeBuild string "$(xcodebuild -version | awk 'NR==2 {print $3}')"
set_key DTCompiler string com.apple.compilers.llvm.clang.1_0
set_key BuildMachineOSBuild string "$(sw_vers -buildVersion)"
pb "Merge $work/icons.plist" "$plist"
plutil -convert binary1 "$plist"

cp "$profile" "$app/embedded.mobileprovision"
# The profile's entitlements, keeping the identity ones and those the app asks for.
entitlements="$work/entitlements.plist"
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$work/profile.plist" > "$entitlements"
top_keys() { plutil -p "$1" | sed -n 's/^  "\([^"]*\)" => .*/\1/p'; }
wanted="$(top_keys "$here/ios/StellaRune/StellaRune.entitlements")"
for key in $(top_keys "$entitlements"); do
  case "$key" in
    application-identifier|com.apple.developer.team-identifier|get-task-allow|beta-reports-active|keychain-access-groups) ;;
    *) grep -qxF "$key" <<< "$wanted" || pb "Delete :$key" "$entitlements" ;;
  esac
done
for key in $wanted; do
  pb "Print :$key" "$entitlements" >/dev/null 2>&1 || echo "note: the profile doesn't grant $key; the build goes without it" >&2
done
pb "Delete :keychain-access-groups" "$entitlements" >/dev/null 2>&1 || true
pb "Add :keychain-access-groups array" "$entitlements"
pb "Add :keychain-access-groups:0 string $team.$bundle_id" "$entitlements"

sign=(codesign --force --sign "$identity" --entitlements "$entitlements" --generate-entitlement-der)
[[ -n "$keychain" ]] && sign+=(--keychain "$keychain")
"${sign[@]}" "$app"
codesign --verify --strict --verbose=1 "$app"

ipa="$out/StellaRune-$version-$build.ipa"
rm -rf "$work/Payload" "$ipa"
mkdir -p "$work/Payload"
cp -R "$app" "$work/Payload/"
(cd "$work" && ditto -c -k --sequesterRsrc --keepParent Payload "$ipa")
echo "packaged $ipa ($bundle_id $version ($build), $(du -h "$ipa" | cut -f1))"

if [[ $upload == 1 ]]; then
  xcrun altool --upload-app -f "$ipa" -t ios --api-key "$api_key" --api-issuer "$api_issuer" --p8-file-path "$p8"
fi
