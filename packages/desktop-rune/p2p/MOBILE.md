# stella-p2p on phones

The same crate runs the desktop engine's direct device link and a phone's. A phone is a *device*:
it pairs with a computer's code (`pair`), then talks to that computer (`request`, events).

## Rune phone app (`packages/mobile-rune`, branch `rune/mobile`)

- Add `stella-p2p = { path = "../../desktop-rune/p2p" }` to `mobile-rune/engine/Cargo.toml` and
  include the desktop engine's `src/p2p.rs` by path like the other shared modules. Route
  `p2p.*` commands to it the way `desktop-rune/engine/src/commands.rs` does.
- The JS side is shared as is: `host/services/p2p/{link,peer-chats}.ts` only need a
  `P2pTransport` (`command`, `on`), which the phone host gets from its engine bridge.
  `computer.ts` (the host role) stays desktop-only.
- Android: the app is a NativeActivity through winit/android-activity, which already hands
  `ndk-context` the JVM and Context. Don't also call `stella_p2p_android_init` there; it would
  initialize ndk-context a second time.

## React Native app (`packages/mobile`)

- Build the crate with `--features ffi` as a static library (iOS:
  `aarch64-apple-ios`, `aarch64-apple-ios-sim`; `cargo rustc --crate-type staticlib`) or a shared
  library (Android: `cargo rustc --crate-type cdylib --target aarch64-linux-android`) and wrap
  `include/stella_p2p.h` in an Expo native module (`modules/stella-p2p`).
- Android: call `stella_p2p_android_init(vm, context)` once from `JNI_OnLoad` (or the module's
  init) before `stella_p2p_start`. Iroh's DNS resolver reads the system's DNS servers through it;
  without it that one thread panics and lookups by id fall back to the relay and the code's
  addresses.
- Scanning: the QR code holds `stella://p2p?c=<code>`; expo-camera's barcode scanner reads it.
- `dataDir` must be in the app's private storage (it holds the device's secret key).

## Checked

- `aarch64-linux-android` cdylib links with NDK r29 and exports `stella_p2p_start`,
  `stella_p2p_command`, `stella_p2p_stop`, `stella_p2p_android_init`.
- The CLI built for `x86_64-linux-android` paired with a desktop host from the Android 16
  emulator and read its chat over a direct path.
- iOS targets need the Mac (Xcode toolchain); not built here.
