# Stella Feature Map

These notes describe Stella's desktop and iOS surfaces, entry points, and non-obvious dependencies. Consult the notes relevant to the behavior being verified; there is no requirement to read or exercise every linked surface.

The [verification skill](../SKILL.md) defines evidence and isolation boundaries. Driving sections are examples to adapt, not mandatory sequences or exhaustive acceptance criteria. Their expected states describe those examples; choose coverage from the requested behavior, current source, and observed app state.

The [desktop reference](../references/desktop.md) covers harness setup and diagnostics. The [iOS infrastructure reference](ios.md) covers running on the Mac, disposable source staging, dev builds, test-account sign-in, and Simulator control. Keep environment and resource-ownership requirements when adapting an example.

## Desktop features

- [Top bar, tabs and the stage](./top-bar-and-tabs.md) covers the top bar's controls, the + menu and its places, tabs, and the stage they open on.
- [Chat](./chat.md) covers the single conversation's readiness, sending, silent turns, dictation routes, and chat alerts.
- [Rich chat](./chat-rich.md) covers attachments, context, model selection, voice, queued sends, message actions, and artifacts.
- [Home](./home.md) covers the full-body Home overlay, when it shows, and its composer-driven exit.
- [Activity and tasks](./activity-and-tasks.md) covers the Activity mark and list, waiting, long calls, paused groups, stop/resume, and tasks across restarts.
- [Ask cards and chat cards](./asks-and-chat-cards.md) covers question and secure-input cards, asks through the orchestrator, safety stops, and usage limits.
- [Notifications](./notifications.md) covers the bell: what lands there, toasts, and actions.
- [Schedule](./schedule.md) covers the Schedule tab, schedule cards (grouped), fired reminders, and where schedules run.
- [Email](./email.md) covers the Email page Stella keeps, her reads and wakes, taps and rules, and the dev email account.
- [Updates, drafts and Undo](./updates.md) covers the Update pill, the Updates tab, updates across computers, drafts, and Undo.
- [Record screen](./record-screen.md) covers Show Stella recording on macOS.
- [Files, viewers and Drive](./files-and-viewers.md) covers Files, Trash, the file viewer and its kinds, Drive files and their versions.
- [Browser and takeover](./browser-and-takeover.md) covers the Browser tab, the Stella Browser extension, task tab cleanup, and cloud-browser takeover.
- [Agent cursor and computer use](./agent-cursor-and-computer-use.md) covers computer use on macOS, Windows and Linux/Hyprland, and the agent cursor.
- [Apps](./apps.md) covers empty, loading, populated, and error states of the cloud app library.
- [Settings](./settings.md) covers entry points, tabs, global search, and dismissal.
- [Desktop companion](./companion.md) covers the floating mark: toggle, hover arc, mini composer, bubbles, drag, and shortcut dictation.
- [Account, models and billing](./account-models-billing.md) covers the Account menu, where Stella works, the Models dialog and live model lists, usage, and billing.
- [Claude Code engine](./claude-code.md) covers running on the user's Claude Code: install, plain tool names, auto-update, login ends, and limits.
- [Memory](./memory.md) covers main, rules and area files, who reads them, and sync limits.
- [Desktop first run](./onboarding.md) covers the welcome message, its buttons, and signed-out use.

Personal drafts may be present on the developer's own installs; they are not product features and have no notes here.

## iOS features

- [iOS verification infrastructure](./ios.md) covers running on the Mac, staging, Expo builds, test-account sign-in, Simulator control, evidence, and cleanup.
- [Mobile shell and authentication](./mobile-shell-auth.md) covers startup gates, sign-in (including the dev test-account link), onboarding, and main navigation.
- [Mobile chat](./mobile-chat.md) covers thread selection, composer behavior, messages, artifacts, and browser intervention cards.
- [Mobile account and pairing](./mobile-account-pairing.md) covers account settings, desktop pairing, Cloud Home, appearance, and sign-out.
- [Mobile sharing and notifications](./mobile-share-and-notifications.md) covers share intake, deep links, notifications, and OS share output.
