# Desktop onboarding

First run is a chat-style walkthrough (`global/onboarding/chat/OnboardingChat.tsx`, steps in `onboarding-chat-flow.ts`, cards in `chat/cards/`). It runs without an account: the desktop works signed out (a local chat), and signing in is optional for local use but needed for the cloud, the phone, Drive, email and apps.

## Steps

Two steps: **signin** (titled "Choose your AI", the first thing on launch: picks Claude Code once when the CLI is installed and signed in, otherwise Stella; installs Claude Code when it's missing, with progress), then **extras** (one optional card: Connect Gmail when signed in to a Stella account, the Chrome extension, and on macOS Accessibility and Screen Recording; "Start chatting" goes straight into the chat). Progress and answers persist in ui-state, so a reload resumes; someone part-way through the old ten-step setup resumes at the step that replaced theirs (demos → signin, later steps → extras). New desktop installs follow the system light/dark setting; Theme lives in Settings and the top-bar menu.

After use, two one-time nudges (`features/nudges/`, state in ui-state `stella:usage-nudges`): "How did you find Stella?" above the composer after 3 finished replies (only when anonymous counts are on; one tap answers, ✕ counts as skipped), and the phone app in the bell on a second day with a reply, or after 6 replies (its action opens the phone dialog; dismissing ends it). One per app run. Installs that finished the old setup start with both done.

A signed-out desktop always opens a local chat (`local_…`) with Sign in at the top right (no banner), never a sign-in screen: on a fresh install, after "Skip setup", on reopening, and after signing out (which also offers the sign-in dialog with the remembered account, `auth/RememberedAccountSignIn.tsx`). Picking a Stella model while signed out (Models menu, composer picker, @Stella, Image) opens the dialog and applies the pick after sign-in. Only the web shows a full-page sign-in (`SignInScreen`; a browser has no local chat); signing in later asks keep-local or sync (`SignedOutLocalChoice`), and sync imports the local chat's text. A self-hosted install pairs with its server instead.

## Driving it

- Fresh install: `session launch --account signed-out --first-run`. With an account: `--first-run` alone (the account is minted, onboarding still runs).
- Arrival at a size: `inspect eval --js 'window.resizeTo(w, h)'`, then `location.reload()`; progress survives and the step lands like a first open.
- Reduced motion: CDP `Emulation.setEmulatedMedia` on the run's `cdpPort`, on the same connection as your checks.
- Missing Claude Code: launch with a `PATH` without mise and `~/.local/bin`, or `STELLA_CLAUDE_CLI_PATH=/nonexistent/claude`.
- A `--claude-login` run seeds the Claude Code engine and hides first-run engine defaults; to see them, stop the run's Electron tree, write `{}` to the run's `data/preferences.json`, and `session relaunch`.
- "Connect Gmail" and "Continue with Google" open tabs in the user's real Chrome: close them yourself and never sign in with the user's accounts.

## Gotchas

- Onboarding-complete is per install, not per account.
- Trigger the nudges without many real turns: edit `stella:usage-nudges` in the run's `data/ui-state.json` (`replies`, `days`), which the app picks up live.
- Anonymous counts from a test copy go to the dev dataset (`stella_anonymous_counts_dev`); `node scripts/awareness/weekly-counts.mjs --dev` summarises the setup funnel, day-1 messages and failed replies.
- Phone pairing has no codes or QR any more: the phone signs in to the same account (see [mobile account](./mobile-account-pairing.md)).
