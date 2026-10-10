# Stella CarPlay

A voice-only CarPlay surface: tap **Talk to Stella**, speak, tap again to send.
Every assistant message is read aloud.

## Voice behaviour

- **Talk row.** Tap to start listening, tap again to send. On iOS versions
  where the app's CarPlay category allows it, a `CPVoiceControlTemplate` with
  **Send** and **Cancel** buttons is shown while listening.
- **Every reply is spoken**, one at a time, in transcript order. While a turn is
  still running, a reply is held until its text stops changing (700 ms).
- **Barge-in.** Tapping while Stella speaks cuts the speech off immediately and
  starts listening. Anything that was queued or arrives while the driver is
  talking is dropped; only messages that arrive after the send are spoken.
- **Hear the last reply** replays the newest assistant message.
- The phone's realtime **Voice** setting does not gate CarPlay. CarPlay uses
  dictation, not realtime voice.
- No reply text is shown on the car screen.

Code: `src/carplay/CarPlayBridge.tsx` (voice loop), `reply-queue.ts` (what gets
spoken), `carplay-home.ts` (rows), `native.ts` (module wrapper).

## Native module

`modules/stella-carplay` is a local Expo module. It owns:

- `StellaCarPlaySceneDelegate`: installs the list template the moment CarPlay
  connects, from the last rows JS sent (or a "Starting…" row before JS runs).
  Row taps and voice-template buttons are events to JS.
- `StellaPhoneSceneDelegate`: attaches the AppDelegate's React Native window to
  the phone scene, forwards URLs, user activities and quick actions (warm and
  cold) to the AppDelegate, and tracks whether the phone scene is in the
  foreground.
- `isPhoneForeground()`: push presentation uses it, because a foreground
  CarPlay scene makes iOS report the whole app as active even with the phone
  locked.
- `relaxKeychainAccessibility()`: moves SecureStore items to
  "after first unlock", so a locked-phone CarPlay launch can read the session.
  New writes already use that setting through `src/lib/secure-store.ts`.
- `setBackgroundActivity()`: keeps the app alive between queued replies when
  the car screen shows another app.

`plugins/withStellaCarPlay.js` declares the two scenes
(`UIApplicationSupportsMultipleScenes: false`) and writes
`StellaCarPlayCategory` (`voice` when the voice-based conversation entitlement
is in `app.json`, otherwise `audio`). The voice template is used only where the
category allows it: voice on iOS 26.4+, audio on iOS 27+.

Background audio (`UIBackgroundModes: audio`) comes from the `expo-audio`
plugin. Car playback asks for `shouldPlayInBackground` and ducks other audio.

## Entitlement

Today: `com.apple.developer.carplay-audio`. Requested:
`com.apple.developer.carplay-voice-based-conversation` (iOS 26.4+). When
granted, swap the key in `app.json`, regenerate the EAS provisioning profile,
and rebuild; the plugin switches the category automatically.

## Testing

CarPlay needs a native build (not Expo Go). Build with the verify-stella iOS
helper, then in Simulator use **I/O → External Displays → CarPlay**. The
CarPlay Simulator does not enforce entitlements.
