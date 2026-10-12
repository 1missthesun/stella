# Slack Stella

A Slack app that gives a workspace its own shared Stella, shaped like Claude
in Slack: people mention `@Stella` in a channel or DM her, and anyone in the
thread can keep steering her. Code: `src/slack/`.

## How it works

- **Install:** any workspace installs through `<auth>/api/slack/install`
  (OAuth v2). The bot token is stored per workspace in D1
  (`slack_installations`), AES-GCM encrypted under a key derived from
  `BETTER_AUTH_SECRET`. Nothing is hardcoded to one workspace.
- **Owner:** the person who installed the app connects their Stella account
  (the install page offers it, as do `/stella connect` and the App Home tab).
  That account owns the workspace's Stella: it pays for her usage there and
  holds the workspace's home, a folder in its Drive (`Slack/<workspace>/`,
  `slack_installations.home_folder`). Nobody else needs a Stella account.
- **Conversations:** each Slack thread is its own conversation, and each
  person's DM with Stella is one more. They run in the cloud under the
  owner's account but are the workspace's, not the owner's: they never show
  in the owner's chat list, can't become the owner's main chat, and the
  owner's Stella and the workspace's can't list or message each other's
  sessions or agents (`slack/conversation-id.ts`).
- **The workspace's Stella** (`workspace.ts`): a `slack-` conversation runs on
  its own system prompt (`slack.md`) instead of the orchestrator prompt and
  the owner's personality, always on Stella's cloud models. She doesn't get
  the owner's memory, skills, connectors, devices, ask cards or browser
  handoffs. Her tools: web, code, image_gen, html, map, Read (bundled skills
  and the workspace's files), drive, her own thread's history, cloud agents,
  and `slack_memory`. Separation is structural plus the prompt, which knows
  she is talking to many people and what not to repeat elsewhere.
- **Memory:** short notes in the home folder: `memories/workspace.md`
  (written from public channels), `memories/channels/<channel>.md`,
  `memories/people/<user>.md` and `memories/dms/<user>.md`. Each turn loads
  the workspace's and this place's notes and the notes about the requester and
  the thread's recent participants.
- **Context:** messages the Events API delivers are cached briefly
  (`slack_messages`), and a request's prompt carries the thread so far from
  that cache. The rate-limited history API is read once at most, for a mention
  inside a thread Stella hasn't seen.
- **Replies:** the conversation object mirrors itself into the thread
  (`relay.ts`): Stella's replies (including agent results posted after the
  request turn ended), one progress checklist per request with a Stop button
  anyone in the thread can press, files she and her agents produce, and 👀 on
  a request until its work is done. Files people share with a request land in
  the home folder and are attached to the turn. A thread reply that isn't
  meant for her gets the reply `<no-reply/>`, which posts nothing.

## Set up an app

1. Create a Slack app from `app-manifest.dev.json` (dev backend) or
   `app-manifest.prod.json`. If you self-host, swap the auth domain first.
2. Put its credentials on cloud-builder:
   `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (pipe each
   into `bunx wrangler secret put NAME`, `--env production` for prod).
   `OAUTH_STATE_SECRET` must also be set.
3. Apply the D1 migrations (`migrations/0009_slack.sql`, `0010_slack_workspace.sql`) and deploy
   cloud-builder.
4. In the app's Event Subscriptions, retry verification of the request URL.
5. Install into a workspace by opening `<auth>/api/slack/install`.
   Don't use "Install to Workspace" in Slack's settings, because that skips
   storing the token.

Listing in the Slack Marketplace later only needs Slack's review. The app is
already a distributed OAuth app.
