# Home

Home is the empty state of the conversation: a full-body overlay over the chat column (`.full-body-home-overlay`) with a time-of-day greeting ("Good night") and the main composer centred. It is not a launcher; places open from the top bar's + menu (see [top bar and tabs](./top-bar-and-tabs.md)).

## Sub-features

- `home-open` shows the overlay automatically on an empty conversation.
- `home-compose` accepts a prompt in the Home composer (**Do anything**, Add, dictation).
- `home-exit` returns to the chat timeline after a send.

## When Home shows

The rule is `chatHomeSurface` in `packages/desktop-ui/src/shell/use-chat-home-surface.ts`, the one place that decides:

- Home is the empty state only: it shows when the conversation is known to have no messages.
- A conversation with messages never shows it: not at launch, after a reload or restart, after any idle time, or when coming back from Settings or a tab.
- While the messages are not known yet (launch, sign-in, slow sync, offline) the timeline shows, unless this computer last knew that same conversation to be empty (`view.chat.emptyConversation` in the durable UI state), in which case Home paints at once.
- "Known empty" for a cloud conversation means the journal is canonical and the records on hand reach its head; `ready` arrives before the records do.

## Driving it with control-stella

Preconditions: a fresh `session launch --replace` (a new account) gives an empty conversation; there is no New chat control to make another.

- **Open.** `node .agents/skills/verify-stella/control-stella.mjs nav home` checks the overlay and fails with `APP_NOT_READY` when Home is not showing; it never creates a conversation.
- **Inspect.** `inspect components`: the Home composer (`Do anything`), **Add**, **Start dictation**, the send button.
- **Exit.** `node .agents/skills/verify-stella/control-stella.mjs chat send --text "<prompt>"`; require `homeOpen: false` in `inspect state` and the message in the timeline.

## Gotchas

- Nothing brings Home back once the conversation has messages; a claim that needs Home needs a fresh account.
- Opening a tab from Home puts the stage above the centred composer, so it covers only the top of the window until the first message moves the composer down.
- A test copy relaunched over a populated chat opens on the timeline, never Home.
- Home's mascot animation dominates the window's idle CPU; profile idle cost with Home showing and with a populated chat.
