#!/usr/bin/env bash
# EAS build hook (package.json "eas-build-pre-install"): the stella-views and stella-p2p native
# modules build Rust crates while CocoaPods reads their specs and while Gradle configures them
# (modules/*/scripts/*.sh), and EAS build images ship no Rust. Installs rustup into ~/.cargo,
# which those scripts put on PATH themselves; each crate's rust-toolchain.toml picks its toolchain.
# Android also gets cargo-ndk. Does nothing outside EAS builders.
set -euo pipefail

[ "${EAS_BUILD:-}" = "true" ] || exit 0

export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
fi
rustup --version

if [ "${EAS_BUILD_PLATFORM:-}" = "android" ] && ! command -v cargo-ndk >/dev/null; then
  cargo install -q --locked cargo-ndk
fi
