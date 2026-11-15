# Email and Today

Stella sorts the user's Gmail as it arrives: urgent mail reaches them right away (bell, phone push), the rest waits in **Today** with a reply drafted when one is needed, and noise is skipped. It is on in every build (`EMAIL_FEATURE_ENABLED` in `packages/contracts/email-feature.ts`) but opt-in per user: nothing is read until the user turns sorting on from the Email page. It never posts into the chat; the `email` tool reads, drafts or sends only when the user asks in a chat.

## Surfaces

- **Email tab** (+ menu › Email, with an unseen count; `shell/sidebar-sections/EmailSection.tsx`). States: not connected ("The email that matters" / **Connect Gmail**, "Waiting for Google…"), reconnect, sorting off ("Sort your email" / **Turn on**, then "Sorting your recent mail…"), load error, and on.
- **Today** (`features/email/EmailToday.tsx`): `N open`, each item with its headline, **Done**, **Later** (This evening, Tomorrow morning, This weekend, Next week, a suggested time with its reason, **Pick a time…** › **Bring it back**), a drafted reply (**Send**, **Save draft**, **Cancel**, hold-to-dictate), and "Handle it" / "Tell Stella…" which hand the item to the chat. Toasts confirm with **Undo**. "Nothing open" when clear; **History** shows read and left-out counts per day.
- **Digest and settings** (`features/email/EmailDigest.tsx`, the rest of the page): Needs you / Worth knowing / skipped (with "This one mattered"), "What matters to you" note, **Standing instructions** set in chat ("Tells you right away" / "Stella takes care of it"), **Accounts** (Live via Gmail push, or "Checked every few minutes"), usage ("This month: N sorted · $x", "Sorting is paused until next month"), **Check now**, **Turn off** (deletes the sorted list).
- **Bell** items for urgent mail (`features/email/EmailNotifications.tsx`); the phone has the same Email place and Today view (`app/(main)/email.tsx`).

## Limits

Paid plans: 600 sorted a day and $2 a month; Free: sorting only, 25 a day, $0.01 a month. A user's saved OpenRouter key takes over sorting cost. Sorting runs through OpenRouter.

## Driving it

- Use the dev email QA account: the email QA Gmail account (named in the stella-verify area memory, never in this public repo) is connected with sorting on to dev test account `agent-66147970@test.stella.local`; launch with `STELLA_VERIFY_ACCOUNT_EMAIL=agent-66147970@test.stella.local`, then `nav open --name Email`.
- Put test mail in through the Gmail API (`messages.import`); Gmail doesn't sort mail you send to yourself, and urgent-sounding mail from the developer's own address often lands in Spam first.
- Free states: `backend-call.mjs` with `STELLA_VERIFY_PLAN=free` keeps the account Free (otherwise each call re-mints Pro).
- A fresh test account shows the Connect state; "Connect Gmail" opens a Google consent tab in the user's real Chrome outside the tab group: close that tab yourself and don't sign in with the user's accounts.

## Gotchas

- Prod's email test account has sorting off; turn nothing on there without being asked.
- After a dev deploy an owner's Durable Object can serve old email code for a few minutes; re-test before calling a fix broken.
