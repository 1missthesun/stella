#!/bin/bash
# Bumps the AUR package stella-desktop-bin to a published launcher version and,
# with --push, publishes it to the AUR.
#
#   packaging/aur/bump.sh            # to launcher/stable/VERSION
#   packaging/aur/bump.sh 81         # to a given launcher version
#   packaging/aur/bump.sh --push     # ...then commit and push to the AUR
#
# It pins launcher/releases/<version>/ (unchanging, unlike stable/), takes the
# binaries' sums from that release's SHA256SUMS, re-pins the icon and LICENSE
# to this checkout's origin/master, refreshes the local files' sums and
# regenerates .SRCINFO. A package edit without a new launcher: bump pkgrel by
# hand, then run this with the current version.
#
# Pushing uses the SSH key ~/.ssh/aur_stella (AUR account "fromyou").
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
pkg="$here/stella-desktop-bin"
releases="https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/launcher"
push=0
version=""
for arg in "$@"; do
  case "$arg" in
    --push) push=1 ;;
    [0-9]*) version="$arg" ;;
    *) echo "usage: $0 [version] [--push]" >&2; exit 64 ;;
  esac
done
[ -n "$version" ] || version="$(curl -fsSL "$releases/stable/VERSION" | tr -d '[:space:]')"
case "$version" in '' | *[!0-9]*) echo "bad launcher version: '$version'" >&2; exit 1 ;; esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sums="$tmp/SHA256SUMS"
if ! curl -fsSL "$releases/releases/$version/SHA256SUMS" -o "$sums"; then
  echo "launcher/releases/$version/ isn't published (only launchers published since the" >&2
  echo "versioned copies were added to build-launchers.yml have one)." >&2
  exit 1
fi
sum_of() { awk -v n="$1" '{ f = $2; sub(/^\*/, "", f); if (f == n) { print $1; exit } }' "$sums"; }
x64="$(sum_of stella-launcher-linux-x64)"
arm64="$(sum_of stella-launcher-linux-arm64)"
[ -n "$x64" ] && [ -n "$arm64" ] || { echo "SHA256SUMS for $version lacks a Linux launcher" >&2; exit 1; }

# Prove the pinned x64 binary is there and says the version it should.
curl -fsSL "$releases/releases/$version/stella-launcher-linux-x64" -o "$tmp/launcher"
[ "$(sha256sum "$tmp/launcher" | cut -d' ' -f1)" = "$x64" ] || { echo "x64 launcher doesn't match SHA256SUMS" >&2; exit 1; }
chmod +x "$tmp/launcher"
said="$("$tmp/launcher" --version 2>/dev/null || true)"
[ -z "$said" ] || [ "$said" = "$version" ] || { echo "the launcher says $said, not $version" >&2; exit 1; }

repo="$(git -C "$here" rev-parse --show-toplevel)"
git -C "$repo" fetch -q origin master
commit="$(git -C "$repo" rev-parse origin/master)"
raw="https://raw.githubusercontent.com/1missthesun/stella/$commit"
curl -fsSL "$raw/packages/desktop/build/icon.png" -o "$tmp/icon.png"
curl -fsSL "$raw/LICENSE" -o "$tmp/LICENSE"
icon="$(sha256sum "$tmp/icon.png" | cut -d' ' -f1)"
license="$(sha256sum "$tmp/LICENSE" | cut -d' ' -f1)"
wrapper="$(sha256sum "$pkg/stella-desktop.sh" | cut -d' ' -f1)"
desktop="$(sha256sum "$pkg/stella-desktop.desktop" | cut -d' ' -f1)"

old="$(sed -n 's/^pkgver=//p' "$pkg/PKGBUILD")"
sed -i \
  -e "s/^pkgver=.*/pkgver=$version/" \
  -e "s/^_commit=.*/_commit=$commit/" \
  -e "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('$x64')/" \
  -e "s/^sha256sums_aarch64=.*/sha256sums_aarch64=('$arm64')/" \
  "$pkg/PKGBUILD"
[ "$old" = "$version" ] || sed -i "s/^pkgrel=.*/pkgrel=1/" "$pkg/PKGBUILD"
# The four sums of source=(): icon, LICENSE, wrapper, desktop entry.
python3 - "$pkg/PKGBUILD" "$icon" "$license" "$wrapper" "$desktop" <<'PY'
import re, sys
path, *sums = sys.argv[1:]
text = open(path).read()
block = "sha256sums=(" + "\n            ".join(f"'{s}'" for s in sums) + ")"
text, n = re.subn(r"^sha256sums=\([^)]*\)", block, text, count=1, flags=re.M)
assert n == 1, "sha256sums=() not found"
open(path, "w").write(text)
PY

if command -v makepkg >/dev/null; then
  (cd "$pkg" && makepkg --printsrcinfo > .SRCINFO)
else
  echo "makepkg isn't installed; regenerate .SRCINFO on Arch (makepkg --printsrcinfo > .SRCINFO)" >&2
  exit 1
fi
echo "stella-desktop-bin: $old -> $version-$(sed -n 's/^pkgrel=//p' "$pkg/PKGBUILD") (icon/LICENSE @ ${commit:0:12})"

if [ "$push" = 1 ]; then
  aur="$tmp/aur"
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/aur_stella -o IdentitiesOnly=yes"
  git clone -q ssh://aur@aur.archlinux.org/stella-desktop-bin.git "$aur"
  cp "$pkg/PKGBUILD" "$pkg/.SRCINFO" "$pkg/stella-desktop.sh" "$pkg/stella-desktop.desktop" \
     "$pkg/stella-desktop-bin.install" "$aur/"
  git -C "$aur" add -A
  if git -C "$aur" diff --cached --quiet; then
    echo "The AUR already has this."
  else
    git -C "$aur" -c user.name="FROMYOU, LLC" -c user.email=contact@fromyou.ai \
      commit -q -m "Update to $version-$(sed -n 's/^pkgrel=//p' "$pkg/PKGBUILD")"
    git -C "$aur" push -q origin HEAD:master
    echo "Pushed to https://aur.archlinux.org/packages/stella-desktop-bin"
  fi
fi
