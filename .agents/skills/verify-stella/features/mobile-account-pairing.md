# Mobile account and pairing

The phone's sidebar (`components/sidebar/SidebarNav.tsx`) lists the places **Chat, Schedule, Email, Apps, Files**, with the account entry at its foot opening Settings (`components/SettingsContent.tsx`). Settings sections, in order: Subscription, Server (self-hosted), Cloud Home, Appearance, Notifications (push), ask escalation (how far asks may reach the phone), Voice, About (terms, privacy), Sign out, Delete account. The account's computers are in the chat settings sheet.

## Sub-features

- `mobile-account` shows current identity and account actions.
- `mobile-computers` lists every computer signed in to the account; picking one in the chat settings sheet connects the phone to it (there are no pairing codes).
- `mobile-cloud-home` configures cloud memory/home behavior.
- `mobile-appearance` changes mode, theme, and gradient preferences.
- `mobile-sign-out` returns to the auth gate.

## How to get to it (user POV)

- Open the sidebar (swipe or **Open navigation**) and tap the account entry at its foot.
- Open the chat settings sheet (gear, top right of the chat) to see the account's computers.
- Open Cloud Home, appearance, notifications, plan, or sign-out rows from Settings.

## Driving it with control-stella-ios

Preconditions:

- The app is authenticated on a booted simulator.
- An online computer needs a separate desktop session signed in to the same test account (for example `control-stella.mjs session launch --account pro`, then `sign-in --email` with that run's account); never reuse a production one.

- **Settings.** Capture the Settings frame and require identity plus the sections above.
- **Appearance.** Select a mode or theme, navigate away, return, and require the selected value and visual theme to persist.
- **Cloud Home/browser.** Open the row and require its current enabled, unavailable, or error state. Confirm before any destructive browser-profile reset.
- **Computers.** Open the chat settings sheet and require the verifier-owned desktop to appear; picking it connects without a code.
- **Sign out.** If explicitly in scope, sign out and require the login gate. Treat it as a destructive session mutation and restore test state afterward.

## Gotchas

- Tokens and account identifiers are secrets. Redact them from proof.
- Reset browser profile and sign-out are destructive to the isolated account/session state.
- Some themes force a display mode, so mode controls can be locked by design.
- Cloud Home availability depends on account and backend configuration.
