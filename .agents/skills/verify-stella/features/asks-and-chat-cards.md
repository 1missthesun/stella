# Ask cards and chat cards

Cards that need the user sit with the chat: ask cards above the composer, recovery and limit cards in the chat tail. Updates, email and other non-chat news go to the [bell](./notifications.md), never here.

## Ask cards

Two kinds, from the `ask_user` and `request_secure_input` tools (`features/user-ask/`, mounted by `UserAskList` in `app/chat/ChatColumn.tsx`; question asks stack in `UserAskDeck`):

- **Question card**: one to four multiple-choice questions, `N of M` progress, Previous/Next, **Skip**, **Something else** (typed answer), **Submit**. A non-blocking ask takes its default when its time runs out ("Closes in …").
- **Secure input card** ("Stella needs a value from you"): fields marked sensitive show "Private — Stella never sees it", shared ones "Shared with Stella". Footer: optional note, **Decline**, **Remember on this computer** (on a relayed ask "on the computer that asked"), **Send securely**. Login and card presets give one handle per field. With Remember on, the value is saved under its service/account and reused without asking (Settings › **Saved private values**); off (and every one-time code) means the handle is kept in memory for the task that asked, reusable for 30 minutes, then forgotten; another task gets "belongs to another task". A readable field whose text Stella would redact (it matches a saved secret) comes back as a handle instead (`asHandles`). `replace_saved` shows "The saved value for … didn't work".

Behavior: a task's ask goes to Stella (the orchestrator) first: saved values are tried, then Stella gets a note and 90 s to answer from what she knows; only what she can't settle reaches the user, and after one consult the same ask goes straight to the user for 15 minutes (`packages/agent/src/stella/stella-first.ts`). Asks are cross-device: desktops mirror the cloud's open asks, the phone and web answer them, sensitive fields are sealed to the asking computer's key. Asks expire after an hour. On the phone the card pins its footer (secure: note and "Can't right now", then Remember and Send) and scrolls only the body, so Send stays in view while typing.

## Chat cards

- **Safety stop** (`features/chat/SafeguardChatCard.tsx`, copy in `packages/contracts/safeguard-block.ts`): "This reply was stopped" with **Remove messages**, **Continue with <Opus>** when a non-Opus Claude model was stopped, and after a removal that is stopped again "Still stopped by the safety system" with **Start fresh**. Undo removes everything since the last completed reply from every timeline and from the model's history, leaving no line behind.
- **Usage limit** (Claude plan limit, `features/chat/UsageLimitChatCard.tsx`): in the chat tail, with Resume; tasks resume by themselves at the reset.
- **Held first message**: a send that fails for sign-in or no usable model is held with a composer notice and retried on sign-in or a model change (`features/chat/held-send.ts`).
- Schedule and reminder cards: see [schedule](./schedule.md).

## Driving it

- An ask from a task: `chat send` a request whose task must ask (the orchestrator itself has no `request_secure_input`; a task does). Answer through the card's real controls; read the outcome in the task's report.
- Answer headlessly (another device's answer): `backend-call.mjs view userAsks.open` for `askId`/`revision`, then `POST /api/user-asks/<askId>/answer` with `{askId, revision, kind: "questions", responses: [...]}`.
- Safety stop: send `stella-test-safeguard-block` (or `stella-test-safeguard-block:haiku` to stop only models whose id contains that) in a test copy (`STELLA_DEV_HARNESS=1`) or on a backend with `STELLA_TEST_ACCOUNTS=1` (dev, Previews). Anthropic's own refusal test string does not trip Claude models through Claude Code.
- Tall ask cards put options below the fold: `scrollIntoView` before a `click-xy`.

## Gotchas

- Saved values on a test copy go to its protected-file store, never the login keychain (`STELLA_SAVED_VALUES_STORE=protected_file`).
- `use_secure_value` into a browser field fills through the agent's own browser session and tab ids, not Electron's in-app tab ids.
- A browser fill's receipt names the field the value is in now (found by a salted hash of the value, never the value) and how many elements the selector matched; `into.mode: "move"` clears it from every field first, `"clear"` only clears, and a landing in a visible field other than the selector's target is cleared by itself. Repro page: two text inputs, a decoy first; ask the task to fill with selector `input`, then recover.
- The orchestrator never shows its consult turns: they are hidden in desktop `journal-message-records.ts` and mobile `cloud-journal-projection.ts`.
