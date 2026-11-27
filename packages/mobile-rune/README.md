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
| Push notifications | Done (`Push.swift`, `ui/native/push.ts`). Permission, APNs token exchanged for an Expo push token (the backend sends through Expo, project from `packages/mobile/app.json`), registered at `/api/mobile/push-token`; categories with reminder Done/Snooze and user-ask actions; a tap opens the chat, urgent email opens Email, reminder actions call `schedules.reminderDone/Snooze`; foreground pushes stay silent. Real delivery needs the bundle id Expo holds APNs keys for (`com.stella.mobile`); the dev bundle `com.stella.rune.dev` registers but Apple drops its pushes. | FCM |
| StoreKit 2 (`stella-storefront`) | Done (`Store.swift`, `replace/ui/global/billing/store-checkout.ts`). Like the RN app: no in-app purchase; `Storefront.current` and `Storefront.updates` give the App Store country, and billing checkout sends `source: "ios"` and `appStoreCountry` (the backend offers Stripe checkout only for the US storefront). | Play Billing |
| Dictation and voice | Done (`Mic.swift`, `replace/ui/replace/features/dictation/services/native-microphone.ts`). `AVAudioEngine` capture, 16 kHz mono PCM16 frames to TS as `phone.mic` events, transcribed by the desktop dictation pipeline. Dev launches can set `STELLA_MIC_FILE=<wav>` to feed a file instead of the mic. | `AudioRecord` |
| Sign in with Google/Apple | Done (`SignIn.swift`, `replace/ui/global/auth/native-sign-in.ts`, seam `desktop-rune/ui/global/auth/native-sign-in.ts`). Google: better-auth social sign-in as a native client through the backend's expo-authorization-proxy in `ASWebAuthenticationSession`, OTT redeemed in TS. Apple: `ASAuthorizationController` with a hashed nonce, identity token to `signIn.social`; falls back to Apple's web sign-in where the device has no Apple Account. | Custom Tabs |
| Stella Views (psychoscript) | **To do.** Bring in `rune/views-mobile` / `rune/views-phone`: Views render through the same engine, so they need the view-host commands rather than a new native bridge. | Same |
| Widgets, CarPlay, share extension | Later. These are separate iOS targets that talk to the backend, not to Rune. | n/a |

## Android path

Branch `rune/mobile-android` (Rune fork branch `stella-mobile-android`):

- `LayerHost` built from an `ANativeWindow` (wgpu Vulkan)
- the same `sme_*` API over JNI
- V8 running the same bundle
- a `SurfaceView` driven by Choreographer
- `EditText` views overlaid with the same message protocol as `NativeFields.swift`

The probe already runs in the emulator: rendering, taps, momentum scrolling and IME typing.
