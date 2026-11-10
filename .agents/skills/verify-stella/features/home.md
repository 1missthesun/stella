# Home

Home is the full-body overlay over the chat column: a greeting, the main composer, and a "Right-click to open the workspace panel" hint. It is not a launcher and not the workspace panel's Home tab.

## Sub-features

- `home-open` shows `.full-body-home-overlay` automatically.
- `home-compose` accepts a prompt in the Home composer.
- `home-exit` returns to the chat timeline after a send.

## When Home shows

The rule is `chatHomeSurface` in `packages/desktop-ui/src/shell/use-chat-home-surface.ts`, the one place that decides:

- Home is the empty state only: it shows when the conversation is known to have no messages.
- A conversation with messages never shows it: not at launch, after a reload or restart, after any idle time, or when coming back from Settings or a top-bar tab.
- While the messages are not known yet (launch, sign-in, slow sync, offline) the timeline shows, unless this computer last knew that same conversation to be empty (`view.chat.emptyConversation` in the durable UI state), in which case Home paints at once.
- "Known empty" for a cloud conversation means the journal is canonical and the records on hand reach its head; `ready` arrives before the records do.

## How to get to it (user POV)

- Launch Stella on an empty conversation (a fresh account).
- Send from Home to enter the timeline.

## Driving it with control-stella

Preconditions:

- The desktop verifier is healthy and no dialog is open.
- A fresh `session launch --replace` gives an empty conversation. There is no New chat or history control to create another.

- **Open.** After a fresh launch, run `node .agents/skills/verify-stella/control-stella.mjs nav home`. It checks the overlay and never creates a conversation; it fails with `APP_NOT_READY` when Home is not showing.
- **Inspect.** Run `node .agents/skills/verify-stella/control-stella.mjs inspect components` and require the Home composer (`Do anything`), dictation and voice buttons, and the right-click hint.
- **Proof.** Run `inspect aria --path .agents/skills/verify-stella/artifacts/home/open.aria.txt` and `inspect screenshot --path .agents/skills/verify-stella/artifacts/home/open.png`.
- **Exit.** Run `node .agents/skills/verify-stella/control-stella.mjs chat send --text "<prompt>"`. Require `homeOpen: false` from `inspect state` and the sent message in the timeline.

## Gotchas

- There is no top-bar Home launcher, conversation history, or New chat control.
- Nothing brings Home back once the conversation has messages; a claim that needs Home needs a fresh account.
- The workspace panel's `Home` tab (Files, Apps, Browser, Updates launcher) is a separate surface from the chat Home overlay.
