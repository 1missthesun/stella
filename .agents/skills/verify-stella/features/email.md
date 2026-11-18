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

- Test Email only against the fake Gmail (`workers/cloud-builder/src/owner-store/domains/fake-gmail.ts`). Never put test mail into, or send it from, a real person's inbox: a real inbox is also read by its owner's production Stella, so fake mail there reaches their phone as real.
- A fake inbox is `<name>@fake-gmail.test`, kept with a dev test account (`@test.stella.local`; test accounts must be on). It answers the Gmail calls Email makes (history, messages, threads, search, labels, drafts, send) from stored messages and never reaches the network: sent replies stay in its Sent folder. An account with a fake inbox reads only fake inboxes.
- The admin email probe (`POST /api/admin/test-accounts/email-probe`, `{ownerId, action, args}`):
  - `fakeInbox` `{email, remove?, forgetGoogle?}` adds or removes a fake inbox. `forgetGoogle` drops the test account's real Google connection without revoking it at Google (dev and production can share one Google app, so a revoke can end the person's production grant).
  - `import` `{raw, account}` puts a raw RFC 822 email into a fake inbox as if it had just arrived (Gmail push included); it refuses any other inbox. Use senders at `*.example`.
  - `fakeList` `{email}` lists the inbox (labels, from, to, subject) to check what Stella sent, drafted or archived.
  - `readNow` runs a read; `tool` runs an `email` tool call (`args` = tool args) as the owner.
- The dev account `email-e2e2@test.stella.local` has `qa-inbox@fake-gmail.test`: `STELLA_VERIFY_ACCOUNT_EMAIL=email-e2e2@test.stella.local`, then `nav open --name Email`. Read the page with `backend-call.mjs view email.page '{}'`.
- Keep the account on Pro (`STELLA_VERIFY_PLAN=pro`): a session relaunch re-mints the launch plan, and Free's gate budget ($0.01 a month) runs out fast, after which nothing wakes Stella early.
- The page lives in an iframe: click its buttons with `drive click-xy`; type into it via CDP `Input.insertText`.
- To see a wake, add a wake rule (`email.tool` `{"action":"rules","op":"add","kind":"wake",...}`) and import matching mail; outside quiet hours an urgent-sounding email wakes her too.

## Gotchas

- Prod's email test account has Email off; turn nothing on there without being asked.
- After a dev deploy an owner's Durable Object can serve old email code for a few minutes; re-test before calling a fix broken.
- Page items Stella wrote under older guidance keep their old text until she rewrites them.
