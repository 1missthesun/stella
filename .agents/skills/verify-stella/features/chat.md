# Chat

Chat is Stella's primary desktop surface: one long-running conversation, always the pinned **Chat (⌘1)** tab. The user writes in the composer ("Do anything") and the turn runs where Stella works (top bar computer picker: this computer, another computer, or the cloud). There is no conversation history, conversation tabs, or New chat control; the active conversation comes from the root route (`?c=`).

## Sub-features

- `chat-ready`: an active conversation id on the chat surface and an enabled composer.
- `chat-send`: the user bubble appears at once. Each send is kept in localStorage until the runtime takes it (shows "Sending…", replayed after a relaunch; `features/chat/pi/desktop-send-outbox.ts`); a turn whose journal mirror hasn't reached the cloud shows "Not synced yet". A send that fails for sign-in or no usable model is held with a composer notice and retried.
- `chat-silent-turns`: when a turn has nothing to say (for example a task report that needs no reply) the orchestrator writes `<no-reply/>` (`SILENT_REPLY_MARKER` in contracts); every surface drops a reply that is only the marker or an old placeholder ("No response requested.", "No reply needed.", `NO_REPLY`; `isSilentReplyText`), so nothing is posted.
- `chat-dictation`: the mic button records with a waveform row under the unchanged textarea and a timer; there are no partial words. Routes (`features/dictation/services/dictation-transcriber.ts`): signed in with streaming on, the Meta realtime relay (`/dictation/socket`); signed in otherwise, managed `/api/dictation/transcribe`; signed out, the user's OpenRouter key; on a Mac, Apple's on-device recognizer when nothing else is available and as the fallback whenever the chosen route fails (signed out, usage limit, offline, bad key). With no route at all the button opens "Turn on dictation". The mic opens only on the tap and closes right after.
- `chat-alerts`: an unread count on the dock/taskbar icon and a message sound (default Bubble; Settings › General) for Stella's visible messages while the chat isn't in view; quiet hours and Linux Do Not Disturb are respected (`features/chat-alerts/`). Test copies are muted unless launched `--audible`.

## How to get to it (user POV)

- Launch Stella. An empty conversation opens on [Home](./home.md); after the first send the timeline replaces it.
- Type in **Do anything** and press Enter (Shift+Enter for a newline).
- Pick where it runs from the computer icon (**Where Stella works**) in the top bar.

## Driving it with control-stella

Preconditions: `session doctor` healthy, no dialog or menu over the composer, and a fresh `session launch --replace` for an empty conversation.

- **Ready.** `node .agents/skills/verify-stella/control-stella.mjs chat ready`; require `ready: true`, a conversation id and an enabled composer (retry once right after launch).
- **Draft.** `node .agents/skills/verify-stella/control-stella.mjs drive fill --placeholder "Do anything" --value "hello"`, then capture `inspect screenshot`.
- **Send.** `node .agents/skills/verify-stella/control-stella.mjs chat send --text "hello from verify-stella"`; require the user message or a bounded visible error. Don't wait indefinitely for model output.
- **Cloud working state.** Choose **Where Stella works** › **Cloud**, send a turn that delegates a delayed task. Require Stop while Stella responds, then no Stop or trailing working dots after its acknowledgment while the task runs, after the task's reply, and after a reload.
- **Silent turn.** Have a task report something that needs no answer and require no new assistant bubble (the journal has the marker; no surface shows it).
- **Durable send.** Send, then stop the run's worker before it takes the message and relaunch: the bubble must come back "Sending…" and go out once.
- **Dictation.** Launch with `--fake-mic <16 kHz WAV of speech>` (a file outside `~/.stella` on Linux), press **Start dictation**, wait, press **Stop dictation and transcribe**, and require the words in the composer. For the own-key path run against a backend without managed dictation and save an OpenRouter key when asked. The Mac fallback needs the Mac and `--own-app-identity` (Speech Recognition prompt).

## Gotchas

- `chat send` from Home samples the Home composer, which is swapped out, so `composerCleared` can read false; check `inspect state`.
- `drive press --key Control+KeyV` (or `Meta+KeyV`) runs Chromium's real paste from the system clipboard; plain synthetic key events never reach the native Edit menu.
- The `--fake-mic` WAV is the only microphone; a log line `Failed to read … as input to the fake device` means silence.
- A live reply depends on providers; the user turn or an explicit error is enough for the submission path.
- Don't assert a conversation title at once; history and titles update asynchronously.
- Assistant replies have no "Show more" or report popover (removed on purpose); a task's report is reached from its quote bubble and lifecycle row.
