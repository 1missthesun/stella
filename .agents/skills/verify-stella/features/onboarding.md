# Desktop first run

There is no setup walkthrough. A new install (onboarding-complete unset) is marked complete at once (`shell/FullShell.tsx` → `features/welcome/first-run.ts` `beginFirstRun`) and opens straight on its chat. The first chat it opens starts with Stella's welcome message: one assistant message, written for someone new to computers, with small buttons under the lines they belong to (`features/welcome/WelcomeMessage.tsx`; text in contracts `welcome-message.ts`). It works without an account: the desktop runs signed out (a local chat), and signing in is optional for local use but needed for the cloud, the phone, Drive, email and apps.

## The welcome message

- Stored as a mark, drawn from the contracts text by each client, so the wording and buttons stay current. A chat kept on this computer gets it from the chat host's `welcome` op (only into an empty `local_` chat, once per install via ui-state `stella-welcome-pending`); an account's chat gets a `welcome` journal card the cloud posts when it creates a new account's main chat. Signing in and importing a local chat leaves the local welcome behind, so there's never two.
- The model reads the same text as its own opening turn.
- Buttons (each hides once its thing is done): **Get Stella for Chrome** (until an extension is connected), **Connect Gmail** (signed in, not yet connected), **Watch it work** (errands demo in the viewer); **Sign in** when signed out, else **Get the phone app** until a phone session exists; **See how** (memory demo); **Connect a plan** opens the Choose your AI dialog (`features/welcome/ChooseAiCard.tsx`: Stella account, Claude Code with install, ChatGPT, API key) until a non-Stella engine or key is in use; **Change how I look** (theme picker) and **Watch it change** (customize demo). Terms and Privacy sit in a quiet line under it.
- macOS Accessibility and Screen Recording are asked for when Stella first needs them, not up front.
- First run still picks Claude Code once when the CLI is installed and signed in and nothing else was chosen. New installs follow the system light/dark setting.

After use, two one-time nudges (`features/nudges/`, state in ui-state `stella:usage-nudges`): "How did you find Stella?" above the composer after 3 finished replies (only when anonymous counts are on; one tap answers, ✕ counts as skipped), and the phone app in the bell on a second day with a reply, or after 6 replies (its action opens the phone dialog; dismissing ends it). One per app run. Installs that finished the old setup start with both done.

A signed-out desktop always opens a local chat (`local_…`) with a dismissible sign-in banner, never a sign-in screen: on a fresh install, on reopening, and after signing out (which also offers the sign-in dialog with the remembered account, `auth/RememberedAccountSignIn.tsx`). Picking a Stella model while signed out (Models menu, composer picker, @Stella, Image) opens the dialog and applies the pick after sign-in. Only the web shows a full-page sign-in (`SignInScreen`; a browser has no local chat); signing in later asks keep-local or sync (`SignedOutLocalChoice`), and sync imports the local chat's text. A self-hosted install pairs with its server instead.

## Driving it

- Fresh install: `session launch --account signed-out --first-run`; the welcome is `[data-testid="welcome-message"]`, each button `[data-welcome-action="<line>:<button>"]`. With an account: `--first-run` alone (a freshly minted account's chat gets the cloud's welcome).
- Reduced motion: CDP `Emulation.setEmulatedMedia` on the run's `cdpPort`, on the same connection as your checks.
- Missing Claude Code: launch with a `PATH` without mise and `~/.local/bin`, or `STELLA_CLAUDE_CLI_PATH=/nonexistent/claude`.
- A `--claude-login` run seeds the Claude Code engine, which hides "Connect a plan"; to see it, stop the run's Electron tree, write `{}` to the run's `data/preferences.json`, and `session relaunch`.
- "Connect Gmail", "Get Stella for Chrome" and "Continue with Google" open tabs in the user's real Chrome: close them yourself and never sign in with the user's accounts.

## Gotchas

- Onboarding-complete is per install, not per account.
- Trigger the nudges without many real turns: edit `stella:usage-nudges` in the run's `data/ui-state.json` (`replies`, `days`), which the app picks up live.
- Anonymous counts from a test copy go to the dev dataset (`stella_anonymous_counts_dev`); `node scripts/awareness/weekly-counts.mjs --dev` summarises the setup funnel, day-1 messages and failed replies.
- Phone pairing has no codes or QR any more: the phone signs in to the same account (see [mobile account](./mobile-account-pairing.md)).
