#!/usr/bin/env bash
set -euo pipefail

dest="${STELLA_VERIFY_XVFB_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/stella-verify/xvfb}"

if [[ -x "$dest/usr/bin/Xvfb" ]]; then
  echo "$dest/usr/bin/Xvfb"
  exit 0
fi

if ! command -v pacman >/dev/null 2>&1; then
  echo "No Xvfb, and this is not an Arch-based system: install your distro's Xvfb package (xvfb / xorg-x11-server-Xvfb)." >&2
  exit 1
fi

version=$(LC_ALL=C pacman -Si xorg-server-xvfb 2>/dev/null | awk -F': ' '/^Version/{print $2; exit}')
if [[ -z "$version" ]]; then
  echo "pacman knows no xorg-server-xvfb package." >&2
  exit 1
fi
arch=$(uname -m)
file="xorg-server-xvfb-${version}-${arch}.pkg.tar.zst"

mapfile -t servers < <(grep -hE '^\s*Server\s*=' /etc/pacman.d/mirrorlist 2>/dev/null | sed -E 's/^\s*Server\s*=\s*//' | head -5)
servers+=("https://geo.mirror.pkgbuild.com/\$repo/os/\$arch")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for server in "${servers[@]}"; do
  url="${server//\$repo/extra}"
  url="${url//\$arch/$arch}/$file"
  if curl -fsSL --max-time 60 -o "$tmp/$file" "$url"; then
    mkdir -p "$dest"
    bsdtar -xf "$tmp/$file" -C "$dest" usr/bin/Xvfb
    if ldd "$dest/usr/bin/Xvfb" | grep -q "not found"; then
      echo "Unpacked Xvfb is missing libraries: $(ldd "$dest/usr/bin/Xvfb" | grep 'not found' | tr -s ' ' | tr '\n' ';')" >&2
      rm -rf "$dest"
      exit 1
    fi
    echo "$dest/usr/bin/Xvfb"
    exit 0
  fi
done

echo "Could not download $file from the pacman mirrors." >&2
exit 1
