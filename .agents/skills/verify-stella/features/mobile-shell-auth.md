# Mobile shell and authentication

The mobile shell resolves startup and onboarding before exposing the main navigation. Stella needs an account: there is no guest or anonymous entry, and a guest session left by an older build is signed out on launch and lands on login.

## Sub-features

- `mobile-startup` resolves splash, stored theme, session, and initial route.
- `mobile-login` accepts supported sign-in flows and visible failures.
- `mobile-test-sign-in` signs a development build into a dev `@test.stella.local` account through `stella-mobile://dev-test-session`. Source: `app/dev-test-session.tsx`, `src/lib/dev-test-session.ts`.
- `mobile-no-guest` proves the login screen offers no way in without an account.
- `mobile-onboarding` steps through required first-run choices.
- `mobile-navigation` exposes chat, search, account, and other main destinations.

## How to get to it (user POV)

- Launch Stella from the iPhone Simulator home screen.
- Sign in when no valid session exists.
- Complete onboarding after the first sign-in.
- Use the main navigation after the auth gate resolves.

## Driving it with control-stella-ios

Preconditions:

- Complete `control-stella-ios.sh doctor`, `stage`, `boot`, and the Expo build/launch recipe in [iOS](./ios.md).
- An authenticated state needs a development build against the dev backend (`control-stella-ios.sh build`) and `control-stella-ios.sh sign-in`.

- **Startup.** Capture `frame` immediately after launch and again after settling. Require splash to resolve to login, onboarding, or main shell.
- **Signed-in state.** Run `control-stella-ios.sh sign-in --plan pro`, capture `frame` once the "Test-account sign-in" screen hands off, and require onboarding or the main shell. Open Settings and read the signed-in account back: Account → Subscription shows **Current plan**, and the account identity is masked until you reveal it. This proves an authenticated session, not the interactive OAuth or Apple flows on the login screen. Onboarding-complete state belongs to the simulator, not the account, so a fresh account on a reused device goes straight to the main shell; check `control-stella-ios.sh app-status` and a `frame` before calling any screen a first-run baseline, and sign out in the app first when the claim is sign-in from signed-out.
- **Interactive login.** OAuth and Apple sheets usually cannot complete in Simulator; capture the login screen and the sheet it opens, and report completion as blocked.
- **No guest entry.** From a fresh login screen, capture an accessibility snapshot and require no **Continue without signing in** control (`continue-without-signing-in-button` is gone).
- **Onboarding.** Advance one visible step at a time, recapturing after every transition. Require the final action to reach the main shell.
- **Navigation.** Tap each visible main destination from fresh inspected coordinates and capture its selected state.
- **Logs.** Use `control-stella-ios.sh logs` after a blank screen, redirect loop, or native crash.

## Gotchas

- Stored session and onboarding state change the initial route.
- Never put credentials in artifacts, shell history, or copied logs. The test account's email and owner id are identifiers, not credentials, and may be reported; the one-time token never may.
- A test account you minted stays on the dev backend. Delete it through the app's Account → Delete account flow when the run is done, and only the account you created.
- OAuth/browser sheets and keyboard presentation can change screen coordinates.
- Simulator cannot prove device-only auth methods or hardware behavior.
