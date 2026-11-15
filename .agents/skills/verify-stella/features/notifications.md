# Notifications (the bell)

The bell in the top bar (`data-testid="notification-bell"`, `features/notifications/NotificationBell.tsx`) holds everything that isn't part of the conversation and isn't about the message being typed. A new item first shows as a toast under the bell (about 6 s, paused while hovered or while the window is unfocused), then stays in the panel with an accent dot until acted on or dismissed. The bell's name becomes `Notifications, N new` while unseen items exist.

## What lands there

Sources call `notify`/`withdrawNotification` or `useNotificationSource` (`features/notifications/notification-store.ts`; kinds `device-change`, `update`, `email`, `sign-in`, `plan`, `problem`, `info`):

- Updates: a change from another computer (**Get** / **Skip**), a version that arrived (**Undo**), an update that needs a merge, drafts that weren't relayed (`features/app-source/AppSourceNotifications.tsx`).
- Claude login heads-up 3 days before it ends (`features/claude/use-claude-login-heads-up.ts`).
- Plan and model: near the allowance, model not on the plan, fallback model used (`use-tier-restricted-model-toast.ts`, `connect-plan/use-connect-plan-heads-up.ts`).
- Problems: failed loads (activity, files, chat activity), failed images and attachments, memory files too big to sync ("Some memory isn't syncing", `features/cloud/MemorySyncNotifications.tsx`).
- Email: urgent mail when sorting is on (`features/email/EmailNotifications.tsx`).
- Onboarding follow-up hints (`global/onboarding/post-onboarding-hints.ts`).

The composer keeps only what holds the typed message: a held send, a Claude sign-in hold, the usage limit, a safety stop, ask cards, voice and dictation, send errors. Nothing about updates renders in the chat tail.

## Driving it

- Open with `drive click --role button --name Notifications` (or the `Notifications, N new` name); the panel is the dialog `notification-panel` with **Clear all**, per-item actions, **Dismiss** and **Keep for later**. Empty reads "Nothing new".
- To produce an item without waiting for a real event, use a real source: a second test copy on the same account making a desktop-ui change gives the other computer a **Get** item (see [updates](./updates.md)); `STELLA_VERIFY_ALLOWANCE=spent` gives the plan items.
- Seen, toasted and dismissed ids persist in ui-state `stella.notifications`; a relaunch must not toast an item again.

## Gotchas

- The same id updates in place and never toasts twice; a source that changes its id on every render toasts repeatedly.
- An action is recorded as handled only after it runs (`0a95f5a1d`); a failing action keeps the item.
- Toasts pause while the window is unfocused, so a test window behind others keeps its toast up.
