# Mobile chat

Mobile chat is the account's one main conversation (the phone shows no other): signed-in users compose and send, dictate, answer ask cards, see schedule cards, open files, and respond to cloud-browser intervention cards when their plan permits them. Routes live in `packages/mobile/app/(main)/chat.tsx`, chat parts in `packages/mobile/src/components/chat/`.

## Sub-features

- `mobile-search` searches the conversation (`components/chat/Search.tsx`).
- `mobile-compose` drafts, attaches (the + menu, `PlusMenu.tsx`), and sends. The composer sizes itself from a hidden copy of the draft, so text set by the app (a dictation result, a cleared draft) grows or shrinks the pill exactly as typing does.
- `mobile-dictation` records with `DictationRecordingBar`; the whole recording is kept through app switches and interruptions (the recorder resumes when the app comes back), and when the live relay fails finishing transcribes the full recording through `/api/dictation/transcribe` instead. The user sees at most one plain sentence, and only when speech was really lost.
- `mobile-ask-cards`: question and secure-input cards above the composer (`components/chat/ask-slot.tsx`); the footer is pinned (secure: note and "Can't right now", then Remember and Send securely) and only the body scrolls, so Send stays in view while typing.
- `mobile-schedule-cards`: schedule notices fold into one grouped row like desktop (`ScheduleNoticeCard.tsx`, `ScheduleNotices.tsx`; see [schedule](./schedule.md)); fired reminders show `ReminderFireCard` with Done / Snooze.
- `mobile-timeline` renders user, assistant, tool, error, and working states. The
  working mark uses the bouncing ellipsis while thinking and animated character
  poses while a labelled tool is active.
- `mobile-replies` matches desktop: ordinary adjacent replies stay plain; returning work has one compact context label. That label and the lifecycle row open the chain in a centred popover (sized to the chain, app background, no dim, X in its footer). Replies have no Show more or report popover (removed on purpose). Files open in the top sheet (no dim, no header, no X): the file name and copy/share/link actions sit in its footer, and pulling the footer up closes it. The popover and the file sheet end above the composer and shrink with the keyboard and a growing composer as they move.
- `mobile-artifacts` opens or shares files and completion output.
- `mobile-browser-intervention` presents pending cloud-browser actions.

## How to get to it (user POV)

- Chat is the first place in the sidebar and where the app opens.
- Type in the composer and send.
- Tap an artifact, completion card, or browser intervention inside the timeline.

## Driving it with control-stella-ios

Preconditions:

- The main shell has a signed-in session and the iOS helper has a booted installed build.
- Sending or intervention behavior needs reachable cloud state.

- **Compose.** Tap the composer, type a unique harmless prompt, and capture the draft before sending.
- **Send.** Submit once and require the user turn, working state, or explicit error. When the working state is reachable, capture frames during thinking and labelled tool work; require the ellipsis to move during thinking and the character body or orbit to change during tool work. Bound the wait and collect logs on failure.
- **Bubble pop and handoff.** Send a short prompt. Require the sent bubble to spring up from its bottom-right corner, then the 200 ms entrance delay before the dots. When the answer lands, require the dots gone at once and the reply popping in from its bottom-left corner with no size morph and no second indicator below it. Capture the pop and settled answer. Reduced motion appears directly; cancellation must leave no dots. Verify scrolling history or opening reply focus does not replay the pop.
- **Replies.** Delegate work, send an unrelated message, and wait for the result. Require a compact task description above the returning result, with no repeated quote or reply-count badge. Tap it and the original lifecycle row separately; require only the related messages above the still-visible composer. Close focus and require the original timeline position. Also verify a normal adjacent answer has no context label.
- **Artifact.** Open a visible artifact and require the preview or native share/open action appropriate to its type.
- **Intervention.** Only when a real card exists, open it and require its declared login/device-code state before taking an action.
- **Local cloud sign-in.** For a real login intervention on iOS, open the card and require the exact gateway-declared HTTPS origin in Stella's local WebView. Complete the fixture sign-in through visible simulator input, tap Done, require the checking/resume state, then have the resumed cloud browser revisit an authenticated page. This proves the cookie crossed through the encrypted import and survived a fresh Browser Run restore.
- **Fallback.** From the same local sign-in surface, choose **Use cloud browser** and require the existing private remote Live View. A same-origin boundary failure or rejected import should also show the fallback explanation without completing the interaction.

## Gotchas

- Mobile chat data is remote and may be empty or delayed. `cloud-turn.mjs` creates its own conversation, which the phone never shows; send from the phone or the account's desktop chat.
- Dictation words can't be proven in the simulator (its mic doesn't hear the Mac's speakers); check capture through the dev log `[dictation] held/captured/missing`.
- The on-screen keyboard moves controls. Recapture the Mac screen before every coordinate action.
- Provider output is not deterministic. Assert stable shell states and the submitted user turn.
- Do not synthesize cloud messages or interventions through backend calls merely to satisfy UI coverage.
- Local capture is cookie-only and iOS-native. It must not inject JavaScript, expose a page message bridge, or inspect DOM/form values. Other platforms use the remote Live View fallback until they have an equivalent privileged cookie API.
