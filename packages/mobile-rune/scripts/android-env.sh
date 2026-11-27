# Sourced by the Android build scripts: the SDK, NDK, JDK and the NDK's clang for Rust's
# Android targets (aarch64 for phones, x86_64 for the emulator).
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  ANDROID_NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)"
fi
export ANDROID_NDK_HOME ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
if [[ -z "${JAVA_HOME:-}" ]]; then
  for j in "$HOME"/.local/share/mise/installs/java/temurin-21* /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/default; do
    [[ -x "$j/bin/java" ]] && { JAVA_HOME="$j"; break; }
  done
fi
export JAVA_HOME
STELLA_ANDROID_API="${STELLA_ANDROID_API:-28}"
ndk_bin="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ndk_bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
for t in aarch64-linux-android x86_64-linux-android; do
  up="$(echo "$t" | tr 'a-z-' 'A-Z_')"
  us="${t//-/_}"
  export "CARGO_TARGET_${up}_LINKER=$ndk_bin/${t}${STELLA_ANDROID_API}-clang"
  export "CC_${us}=$ndk_bin/${t}${STELLA_ANDROID_API}-clang"
  export "CXX_${us}=$ndk_bin/${t}${STELLA_ANDROID_API}-clang++"
  export "AR_${us}=$ndk_bin/llvm-ar"
done
# avdmanager writes AVDs under $XDG_CONFIG_HOME/.android when that is set; the emulator looks here.
if [[ -z "${ANDROID_AVD_HOME:-}" && -d "${XDG_CONFIG_HOME:-$HOME/.config}/.android/avd" && ! -d "$HOME/.android/avd" ]]; then
  export ANDROID_AVD_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/.android/avd"
fi
