#!/usr/bin/env bash
# Re-makes engine/vendor/wry: wry exactly as published on crates.io at <version>, plus
# engine/vendor/wry.patch (an IPC message from a page whose URL http::Uri can't parse, such as a
# data: or about:blank page, reaches the ipc handler instead of being dropped, so executeJavaScript
# and window.parent.postMessage work there). Run it when wry is bumped, then build: a patch that no
# longer applies fails here. If upstream wry takes the change, delete vendor/wry and its patch entry.
# Usage: scripts/vendor-wry.sh <version>     e.g. scripts/vendor-wry.sh 0.58.1
set -euo pipefail
cd "$(dirname "$0")/../engine"
version="${1:?usage: scripts/vendor-wry.sh <version>}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://static.crates.io/crates/wry/wry-$version.crate" -o "$tmp/crate.tar.gz"
tar -xzf "$tmp/crate.tar.gz" -C "$tmp"
rm -rf vendor/wry
mv "$tmp/wry-$version" vendor/wry
patch -p1 --quiet --no-backup-if-mismatch -d vendor/wry < vendor/wry.patch
echo "vendor/wry: wry $version + vendor/wry.patch"
