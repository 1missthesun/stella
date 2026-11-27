# Stella Mobile on Rune

The phone app on Stella's own UI engine. The desktop's Rune engine draws everything (Metal on iOS, Vulkan on Android) and runs the same TypeScript/JSX UI as desktop in-process, in JavaScriptCore on iOS and V8 on Android. Text inputs are the platform's own views, `UITextView`/`UITextField` and `EditText`, placed over the boxes Rune lays out. Rune never draws a text field, so selection, the loupe, dictation, autocorrect, IME, autofill and the spacebar trackpad all stay native.

## Layout

| Path | What it is |
|---|---|
| `engine/` | Crate `stella-mobile-engine`. It includes the desktop engine's modules (`../../desktop-rune/engine/src`) via `#[path]`, adds `src/mobile/*`, and exposes the C API `sme_*` (`include/stella_mobile_engine.h`; JNI on Android). |
| `ios/StellaRune/` | The Swift shell. **`RuneView`**: `CAMetalLayer` and a 120 Hz `CADisplayLink`, with touches sent to `sme_touch`. **`JSRuntime`**: JavaScriptCore on its own thread, with `__native` providing timers, fetch, WebSocket, storage and files. **`NativeFields`**: the UIKit fields. **`Pickers`**: the photo and file pickers. **`DebugDriver`**: dev-only automation. |
| `android/` | The Kotlin shell, on branch `rune/mobile-android`. |
| `js/` | Builds the bundle. `build.ts` produces an iife for JSC/V8 from the desktop host bridge, reconciler and DOM shim plus the shared desktop UI. `replace/<path>` stands in for `packages/desktop-rune/<path>`. |
| `ui/` | Phone-only UI. **`PhoneRoot`** handles the safe area and keyboard. **`phone/PhoneChrome`** holds the glass top bar, the tab bar (Chat, Schedule, Apps, Files), the tab pages and the drawers. **`Probe`** is a first-light screen. |

## Build and run (iOS Simulator)

```sh
packages/mobile-rune/scripts/build-ios.sh [--skip-engine] [--skip-js] [--dist]
```

- Dev builds use the dev backend and include the debug driver. `--dist` uses prod.
- A cold engine build takes about 11–25 minutes. It uses `CARGO_TARGET_DIR=~/projects/.rune-target-mobile`.
- Launch environment variables (via `SIMCTL_CHILD_*`):
  - `STELLA_PHONE_UI=probe|desktop` picks the probe screen or the plain desktop layout.
  - `STELLA_OTT=<token>` signs in. Mint the token with `.agents/skills/verify-stella/scripts/mobile-test-session.mjs`.
- Typecheck with `bun scripts/typecheck.ts`.
- Dev builds poll `Documents/driver.txt`, one command per line: `tap?x=&y=`, `drag?…`, `type?text=`, `key?name=return`, `dark?on=0|1`, `perf?start=L` / `perf?stop=L`, `open`.
- Don't use `simctl openurl` on a running app. iOS shows an "Open in …?" prompt that blocks input until the sim reboots.

## How native fields work

1. The engine lays out an `<input>` and sends `field` (its style) and `place` (its drawn rect, every time it moves) to the app.
2. Swift keeps a `UITextView` exactly there and reports each edit, selection change, focus change and content height back through `sme_field_event`. TS sees an ordinary Rune input.
3. A UIKit view sits above Metal, so after each change `native::check_covers` picks the element at the field's centre. When another top-level layer covers the field (a tab page, a drawer, a dialog), the engine sends `hideField`, and the field drops the keyboard.
4. Focus requests from TS (the desktop composer focuses itself whenever a chat opens) raise the keyboard only within 1.5 s of a touch, so the app opens with the keyboard down.

## Native bridges

| Bridge | iOS | Android |
|---|---|---|
| Text fields, keyboard, safe area | Done (`NativeFields`, `KeyboardWatch`) | EditText overlay (`rune/mobile-android`) |
| Clipboard, open URL / in-app Safari, share sheet, haptics, badge | Done (`App.command`, `Haptics`) | To do (ClipboardManager, Custom Tabs, `ACTION_SEND`, `HapticFeedbackConstants`) |
| Photo and file pickers (`dialog.openFile`) | Done (`Pickers`: PHPicker and UIDocumentPicker, copied to tmp, answered by rid) | To do (Photo Picker, `ACTION_OPEN_DOCUMENT`) |
| Push notifications | **To do.** `UNUserNotificationCenter` permission and APNs token, registered with the backend the way `packages/mobile/src/lib/push*` does; notification taps routed to TS as `{t:"event", ev:"notification"}`. | FCM |
| StoreKit 2 (`stella-storefront`) | **To do.** `Product.products`, `purchase`, and `Transaction.updates`, with the signed transaction sent to the backend; mirror `packages/mobile/modules/stella-storefront`. | Play Billing |
| Dictation and voice | **To do.** The desktop composer's dictation calls the engine's audio commands; on iOS, `AVAudioEngine` capture produces PCM frames to TS, with the mic permission string in Info.plist. Inline dictation in the composer already works through the native field. | `AudioRecord` |
| Sign in with Google/Apple | **To do.** `ASWebAuthenticationSession` returning an OTT to TS. Auth-session reads `#ott` only at module load, so it needs a TS entry point to redeem a token later. | Custom Tabs |
| Stella Views (psychoscript) | Done. Views run in the engine like on the desktop: `engine/src/views.rs` (included by path) runs each program on a thread, `engine/src/mobile/view_frames.rs` makes the display link their frame clock. TS is the web views host (`desktop-rune/web/views/views-host.ts`, conversation-driven, no files) with the phone's VM, storage (JSON files in Documents) and capabilities in `js/replace/web/views/`; `js/views.ts` installs it as `stella.views`. Chat cards, Undo, History and Share links are the shared UI; an opened view (Apps tab, a card's open button) is the full-screen `ui/phone/ViewScreen.tsx`. `STELLA_VIEWS_LOG=1` logs first-tree and swap times. Location is IP-based and notifications aren't wired. | Same; file picks and clipboard reads aren't wired on Android. |
| Widgets, CarPlay, share extension | Later. These are separate iOS targets that talk to the backend, not to Rune. | n/a |

## Android path

Branch `rune/mobile-android` (Rune fork branch `stella-mobile-android`):

- `LayerHost` built from an `ANativeWindow` (wgpu Vulkan)
- the same `sme_*` API over JNI
- V8 running the same bundle
- a `SurfaceView` driven by Choreographer
- `EditText` views overlaid with the same message protocol as `NativeFields.swift`

The probe already runs in the emulator: rendering, taps, momentum scrolling and IME typing.
