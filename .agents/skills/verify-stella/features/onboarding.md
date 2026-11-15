# Desktop onboarding

First run is a chat-style walkthrough (`global/onboarding/chat/OnboardingChat.tsx`, steps in `onboarding-chat-flow.ts`, cards in `chat/cards/`). It runs without an account: the desktop works signed out (a local chat), and signing in is optional for local use but needed for the cloud, the phone, Drive, email and apps.

## Steps

In order: **capabilities**, **selfmod**, **memory** (each a demo film resting on a poster with a play button; demos never autoplay and replay when ended), **signin** (titled "Choose your AI": picks Claude Code once when the CLI is installed and signed in, otherwise Stella; installs Claude Code when it's missing, with progress), **foundVia** (only when anonymous counts are on), **gmail**, **theme**, **extras**, **phone**, **quickstart** (an on-device digest of browsing and recent repos becomes 10–20 lines of "Who the user is" in `main.md`; it waits in memory for an account and never sends data before sign-in). Every step opens at its top and fits the window (`--obc-demo-max-width`). Progress and answers persist in ui-state, so a reload resumes.

After onboarding a signed-out desktop opens a local chat (`local_…`) with a sign-in banner; signing in later asks keep-local or sync (`SignedOutLocalChoice`), and sync imports the local chat's text. A self-hosted install pairs with its server instead.

## Driving it

- Fresh install: `session launch --account signed-out --first-run`. With an account: `--first-run` alone (the account is minted, onboarding still runs).
- Arrival at a size: `inspect eval --js 'window.resizeTo(w, h)'`, then `location.reload()`; progress survives and the step lands like a first open.
- Reduced motion: CDP `Emulation.setEmulatedMedia` on the run's `cdpPort`, on the same connection as your checks.
- Missing Claude Code: launch with a `PATH` without mise and `~/.local/bin`, or `STELLA_CLAUDE_CLI_PATH=/nonexistent/claude`.
- A `--claude-login` run seeds the Claude Code engine and hides first-run engine defaults; to see them, stop the run's Electron tree, write `{}` to the run's `data/preferences.json`, and `session relaunch`.
- "Connect Gmail" and "Continue with Google" open tabs in the user's real Chrome: close them yourself and never sign in with the user's accounts.

## Gotchas

- Onboarding-complete is per install, not per account.
- The profile synthesis wants task-useful lines, never site lists; it has no category filters by design.
- Phone pairing has no codes or QR any more: the phone signs in to the same account (see [mobile account](./mobile-account-pairing.md)).
