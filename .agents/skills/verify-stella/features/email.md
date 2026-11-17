# Email

With Email on, Stella reads the user's Gmail herself, in batches, and keeps one living **Email page**. It is on in every build (`EMAIL_FEATURE_ENABLED` in `packages/contracts/email-feature.ts`) but opt-in per user: nothing is read until the user turns it on from the Email page.

## How it works

- **Reads**: scheduled turns at local hours (paid 8/13/18, Free 9), plus **Check now**. Stella uses the `email` tool (`inbox`, `read`, `search`, `draft`, `send`, `archive`, `page`, `rules`, `off`; `packages/runtime/kernel/tools/defs/email-tool-def.ts`) and answers in chat with `<no-reply/>` or one line. The Email section of her context (`renderEmailAccess` in `packages/contracts/execution-context.ts`) says how.
- **Gate**: each arriving email gets a cheap Decision-model check that only decides whether to wake Stella before her next read (6 wakes a day paid, 2 Free; quiet hours 22–7, except mail matching a "wake" rule). It never decides what the user sees.
- **Page** (backend JSON, view `email.page`; `packages/contracts/email-page.ts`): **Needs you** (gist with Stella's recommendation, a drafted reply behind "Read the reply", one short button plus **Tell Stella** and **Open in Gmail**), **I handled** (Undo only when undoable), **Waiting on others**, an expandable **Ignored** count, and a footer with the reads line, **Your rules** and **Turn off**. Related mail is one item ("2 emails"). The time shown is when the item's newest email arrived.
- **Taps** are canvas actions (`do:<id>`, `undo:<id>`, `tell:<id>`, `check`): they arrive in chat as `<canvas-action>` messages, shown as an "Email · …" chip plus the user's words; the item shows "Stella's on it." until she updates it. `off` and rule removal are handled by the app itself.
- **Urgent** items (Stella's mark) reach the phone as a push and the desktop/web bell; the Email tab shows an unseen count.
- **Rules**: wake (tell at once), act (do it at once), ignore (leave it off the page). "That doesn't matter" in Tell Stella becomes an ignore rule.
- Surfaces: desktop/web `shell/sidebar-sections/EmailSection.tsx` (the page is a canvas frame), phone `src/components/EmailPage.tsx`.

## Driving it

- Use the dev Email QA account `email-e2e2@test.stella.local` (its Gmail is named in the stella-verify area memory, never in this public repo): `STELLA_VERIFY_ACCOUNT_EMAIL=email-e2e2@test.stella.local`, then `nav open --name Email`.
- Put test mail in with the admin email probe (`POST /api/admin/test-accounts/email-probe`, action `import`, `{raw, account}`; Gmail `messages.import` with INBOX and UNREAD). Use senders at `*.example` so a real send bounces harmlessly. Actions `readNow` and `tool` (`args` = `email` tool args) run a read or a tool call as the owner.
- Read the page with `backend-call.mjs view email.page '{}'`.
- The page lives in an iframe: click its buttons with `drive click-xy`; type into it via CDP `Input.insertText`.
- To see a wake, add a wake rule (`email.tool` `{"action":"rules","op":"add","kind":"wake",...}`) and import matching mail; outside quiet hours an urgent-sounding email wakes her too.

## Gotchas

- Prod's email test account has Email off; turn nothing on there without being asked.
- After a dev deploy an owner's Durable Object can serve old email code for a few minutes; re-test before calling a fix broken.
- Page items Stella wrote under older guidance keep their old text until she rewrites them.
