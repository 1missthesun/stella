# Stella for Slack

A Slack app that gives a workspace its own shared Stella, shaped like Claude
in Slack: people mention `@Stella` in a channel or DM her, and anyone in the
thread can keep steering her. Code: `src/slack/`; its settings page is
`packages/website/src/app/slack/` (stella.sh/slack), on the API in
`@stella/contracts/slack-workspace`.

## How it works

- **Install:** a signed-in Stella user adds it from stella.sh/slack ("Add to
  Slack", `POST /api/slack/install/start`), which makes that account the
  owner at once; any workspace can also install through
  `<auth>/api/slack/install` (OAuth v2) and connect afterwards. The bot token is stored per workspace in D1
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
- **Settings** (`settings.ts`, `workspace-api.ts`, D1
  `slack_workspace_settings`), edited on stella.sh/slack by the owner:
  engine (Stella's runtime or Claude Code on the owner's Claude login, which
  needs a plan with cloud access), model, reasoning effort, whether
  `/stella engine|model|effort` may change those from Slack, and a GitHub
  repository that is cloned into every Slack agent's container under
  `/workspace/repos/<name>` before it starts (`repo-clone.ts`), outside the
  owner's world. The page also
  edits `memories/rules.md`, plain-language rules she follows as
  `<workspace-rules>` (no permission system beyond that), and
  `memories/workspace.md`.
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

- **GitHub** (`github.ts`): "Connect GitHub" on the page goes through
  Stella for Slack's own GitHub App (contents write; metadata, deployments,
  statuses and checks read), separate from the projects App. The installer
  picks which repositories it sees; the workspace stores only the
  installation id (`slack_workspace_settings.github_*`). The page lists the
  installation's repositories and a repository's branches; any public
  repository works read-only without connecting.
- **Agents and previews** (`repo-clone.ts`, `repo-capability.ts`): the
  clone's git uses `stella-git-credential`, which trades the container's
  12-hour capability (one workspace, one repository) for a fresh installation
  token per operation at `/api/slack/github/agent/token`; the route rechecks
  the workspace's settings each time, so disconnecting revokes it at once.
  Agents commit and push to the working branch, then `stella-preview` waits
  for the repository's own preview of that commit (GitHub deployments, or a
  preview URL in a deploy check run or status: Cloudflare Pages, Vercel,
  Netlify, …) via `/api/slack/github/agent/preview`. `slack.md` tells Stella
  to brief agents that way and post the link, falling back to a patch.
- **Stella previews** (`previews.ts`, `stella-publish.cjs.txt`): every Slack
  agent container gets `stella-publish` and a 12-hour publish capability (one
  workspace, one conversation) in `/opt/stella-preview`. In a pushed clone it
  prints the repository's own preview when there is one (`stella-preview`);
  otherwise it builds the site and uploads the output as a gzipped tar to
  `POST /api/slack/previews`, which stores the files in `APP_BUILDS` under
  `slack-previews/<id>/` and returns a fresh link with a 128-bit random id.
  Limits: 100 MB and 5,000 files per preview (25 MB per file), and live
  previews per workspace up to the owner's plan (free 250 MB, Go 1 GB, Pro
  5 GB, at most 500 links). The `workers/sites-host` Worker serves each on
  its own origin, `https://<id>.stellasites.app/` (`<id>-dev` on dev; the
  domain is on the Public Suffix List), through cloud-builder's `SitesHost`
  entrypoint,
  with SPA fallback to `index.html` (or the site's `404.html`), content types
  stored at upload, a CSP, and no Stella cookies. The owner sets access and
  expiry on stella.sh/slack (`slack_preview_settings`): members only (the
  default) sends visitors through Sign in with Slack restricted to the
  workspace (redirect URI `<auth>/api/slack/oauth/callback/preview`, a
  subdirectory of the registered one), then an HttpOnly `__Host-` cookie on
  the preview origin. Slack refuses that sign-in for accounts without a
  confirmed email (`user_email_unverified`) and never returns, so the page
  also offers a one-time link the bot DMs to the member with the email
  entered (`users.lookupByEmail`). Public opens for anyone with the link. Links expire
  1–90 days after they're made (default 14, the current setting applies to
  existing links); the daily cron deletes their files.
- **Uninstalls** arrive on the App's webhook and are also noticed whenever
  GitHub refuses a token; the page then shows a reconnect state. Workspaces
  that pasted a token before this keep it (read-only) until they pick a
  repository through the connection.
- **Environment** (`environment.ts`, D1 `slack_environments` and
  `slack_environment_secrets`): one per workspace, next to its repository.
  Every Slack agent container sends all HTTP and HTTPS through
  `SandboxEgress`, which intercepts HTTPS with the container's own trusted CA.
  `slackEgress` then reads the workspace's current settings, cached for 5
  seconds, and allows or refuses each request:
  - **none:** Stella, the model API and the workspace's repository on GitHub.
  - **limited:** also `LIMITED_HOSTS`, the owner's domains and the secrets'
    hosts.
  - **full:** everything.

  Under none and limited the container starts without Internet access, so
  nothing else leaves it. Changing between full and the others restarts it
  at the next agent run.

  Network secrets are sealed in D1 and only decrypted in the egress handler.
  It sets the secret's header on HTTPS requests to its host and hands
  redirects back rather than following them. The container only sees a
  placeholder variable named after the secret.

  The setup script runs once per container start, as `stella-tools` (never
  root) in the repository's checkout. What it exports (PATH included) goes to
  the agent's daemon. A failure is recorded with its log for the page, noted
  in the thread and told to the agent.

## Set up an app

1. Create a Slack app from `app-manifest.dev.json` (dev backend) or
   `app-manifest.prod.json`. If you self-host, swap the auth domain first.
2. Put its credentials on cloud-builder:
   `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (pipe each
   into `bunx wrangler secret put NAME`, `--env production` for prod).
   `OAUTH_STATE_SECRET` must also be set.
3. Apply the D1 migrations (`migrations/0009_slack.sql`, `0010_slack_workspace.sql`,
   `0011_slack_workspace_settings.sql`, `0013_slack_github.sql`,
   `0014_slack_previews.sql`) and deploy cloud-builder, then `workers/sites-host`.
4. In the app's Event Subscriptions, retry verification of the request URL.
5. Install into a workspace from stella.sh/slack, or by opening
   `<auth>/api/slack/install`.
6. GitHub: `node scripts/slack-github-app.mjs manifest --env dev|production`
   prints the App manifest; POST it (form field `manifest`) to the URL it
   names while signed in to the owning GitHub account, and create the App.
   Then `node scripts/slack-github-app.mjs store --env … --code <code>` with
   the `code` GitHub put on the redirect stores `SLACK_GITHUB_APP_*` and
   `SLACK_GITHUB_WEBHOOK_SECRET` without printing them.

A workspace that has both the dev and prod apps installed sends `/stella` to
one of them only; the dev app's command is `/stella-dev` for that reason.
   Don't use "Install to Workspace" in Slack's settings, because that skips
   storing the token.

Listing in the Slack Marketplace later only needs Slack's review. The app is
already a distributed OAuth app.
