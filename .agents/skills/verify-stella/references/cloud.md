# Cloud verification reference

The Electron verifier is only needed for what the desktop itself does: the
execution-target picker, device presence, and the dispatch hand-off. Every
cloud-side cell (cloud orchestrator tools, cloud background agents, follow-ups,
teardown) is faster to drive headless:

- `node .agents/skills/verify-stella/cloud-turn.mjs --prompt "<orchestrator prompt>"`
  mints a Pro test owner through the admin API, posts one turn to the dev
  worker's `POST /conversations/:id/turns` with the owner's JWT, and polls
  `GET /conversations/:id/history` until the turn's final assistant message
  lands. Pass `--conversation <id>` (and the `--email` the first run printed)
  to keep sending into one conversation (follow-ups, `agent_status`,
  `pause_agent` all need that). `STELLA_ADMIN_API_SECRET` comes from the
  environment or the gitignored `workers/cloud-builder/.dev.vars`; the script
  never prints it.
- Objective placement evidence is the owner's agent threads (the
  `agentThreads.recent`, `agentThreads.forConversation`, and
  `agentThreads.running` backend calls the desktop renders, see
  `packages/desktop-ui/src/features/cloud/use-cloud-activity.ts`) and the
  worker tail: `bunx wrangler tail --format json` in
  `workers/cloud-builder` (`sandbox_ready` means a BuildSession container
  attached; an agent on Stella's models runs in its conversation as a pi
  agent, logged as `pi_thread_attempt_started` and
  `pi_thread_attempt_settled`).
  The tail samples under load and dies with the shell that started it, so
  scope it to the tested owner, conversation and turn.
- Reproduce executor bugs before deploying: the built sandbox image can run
  the attached tool host locally (`docker run --rm --entrypoint sh
  stella-v2-cloud-builder-dev-sandboxsmall:<version>`), where stderr is on the
  terminal instead of in a diagnostic event three minutes later. Don't run or
  extend the worker test suites; unit tests are banned in this repo.
- Test an unmerged backend change on your own Preview: `env -u
  CLOUDFLARE_API_TOKEN bun run preview -- up --name <name>` in
  `workers/cloud-builder`, then `STELLA_BACKEND_URL=<printed url> node
  .agents/skills/verify-stella/cloud-turn.mjs ...`. It has its own Durable
  Objects and D1, so its owners, conversations and history never mix with
  dev's, and cloud orchestrator turns on Stella models work there. It has no
  agent containers, so verify sandbox, background-agent, cloud shell and
  cloud Claude Code behavior on dev (deploy dev from a tree that contains
  origin/master; `deploy:dev` refuses anything else). `wrangler tail` does
  not attach to Previews; read the Preview's logs in the dashboard
  (Observability, persisted at full sampling).
- Cloud Claude Code on a test account needs that account's container signed
  in to Claude, which only a person can do, once. Use one stable account so
  the login is reused (`STELLA_VERIFY_ACCOUNT_EMAIL=agent-claude-cloud@test.stella.local`,
  and `--email` with `cloud-turn.mjs`), on dev:
  `node .agents/skills/verify-stella/scripts/backend-call.mjs call engines.startClaudeCloudLogin '{}'`
  prints `loginId` and Anthropic's `authorizeUrl`. Ask the user with
  `request_secure_input`: the link in `detail`, one `code` field marked
  sensitive. Then `use_secure_value` with the command
  `node .agents/skills/verify-stella/scripts/backend-call.mjs call engines.finishClaudeCloudLogin '{"loginId":"<id>","code":"{{secret}}"}'`,
  so the code never enters chat. A code pasted into an ordinary ask card or
  message leaks; don't ask that way. It spends the user's Claude quota, so
  only for claims that need a real cloud Claude Code turn.
- A test account's API JWT lasts 15 minutes. `cloud-turn.mjs` renews it from
  the session before then and on a 401, and `backend-call.mjs` mints one per
  call. A hand-rolled `curl` loop that starts failing with 401 "Your sign-in
  expired" or "Sign in to send messages." needs a fresh JWT (TESTING.md, "Test
  accounts"); the account is still signed in.
- `cloud-turn.mjs` creates a new conversation per run unless you pass
  `--conversation`. The phone shows only the account's main conversation, so
  a headless turn's agents never appear on iOS.
- Call an owner RPC or read a live view as a test account without printing
  tokens: `node .agents/skills/verify-stella/scripts/backend-call.mjs call
  <name> '<argsJson>'`, `... view <name>`, or `... history <conversationId>`.
  It targets `STELLA_BACKEND_URL` and acts as `STELLA_VERIFY_ACCOUNT_EMAIL`,
  else the current desktop run's account, so it can seed or read back what
  the desktop under test shows (schedules, reminders, conversations).
- A worker-only `bun run deploy:dev` takes about two minutes; one that
  rebuilds the image takes six. Never deploy while a cloud thread is
  `running`: the deploy replaces the isolate running it and the turn is
  failed by the heartbeat about a minute later. Dev container rollouts keep
  serving the previous image for a few minutes after a deploy, so give an
  image deploy time before judging a container-side change.
- A thread stuck `running` past its watchdog is expired, not cancelled:
  `POST $CLOUD_BUILDER_URL/sessions/<threadId>/expire` with the service bearer
  and an optional `{"turnId","attemptGeneration"}` body. The BuildSession
  moves its watchdog to now, interrupts a hung fiber, releases the owner's
  world slot and re-arms its alarm; the ordinary timeout path then fails the
  thread while the container's teardown stays alarm-owned debt. The cancel
  route still answers 502 `sandbox_termination_failed` for such a thread.
- Leaked containers (the inventory report's `orphan` rows) are retired
  through the Worker, never Wrangler: from `workers/cloud-builder`, `node
  scripts/retire-sandbox-instances.mjs --environment dev --instance-id <id>
  --apply --confirm <printed> --adapter scripts/retire-sandbox-adapter.mjs`
  with `CLOUD_BUILDER_URL` and
  `BUILDER_SERVICE_SECRET` in the environment. The adapter posts each exact
  tuple to `POST /internal/sandboxes/retire`, which releases keep-alive on
  the sandbox object and destroys it.


These operational notes describe a development environment, not authorization to deploy or retire resources. Check current source and deployment state before relying on recovery details. Scope event evidence to the tested owner, conversation, turn, and attempt; global latest-row queries alone do not establish what this run did.
