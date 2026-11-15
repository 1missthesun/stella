# Activity and tasks

Stella's background work is "tasks" in every user-facing string (code says agents). The orchestrator starts them with `spawn_agent`; they run on this computer, another computer, or the cloud, and report back into the chat.

## Surfaces

- **Activity mark** (top bar centre, `shell/ShellTopBarActivity.tsx`). Disabled unless something counts; its label says `N tasks in progress` or `N paused tasks`, and opening it shows the activity list. Only the orchestrator's direct tasks count, and only while running something now (`isAgentWorking` / `topLevelAgentActivity` in `packages/contracts/agent-ledger.ts`); helpers never get their own row or count. The mark redraws at most 30 fps.
- **Activity list** (`shell/workspace/WorkspaceSections.tsx`, overview variant). Each row: status glyph, title, files the task produced, and a meta line: **Waiting** (the task ended its turn with `end_turn_waiting`), **N min on one step** (one tool call past 12 minutes, `packages/contracts/long-tool-call.ts`; agent_status says "may be stuck"), or nothing. Rows open the task's view ("View activity"; Claude Code chats from the CLI show "Claude · read-only").
- **Paused groups.** Held tasks sit in a `Paused · <reason>` group instead of counting as running (`packages/contracts/agent-pause.ts`): `<computer> is off`, `usage limit reached`, `needs a sign-in`. A computer-off pause needs the backend's `runsOnDeviceId`.
- **In the chat**: a spawn row under the reply that started the task, and a quote bubble over the reply that relays its result (see [rich chat](./chat-rich.md)).

## Behavior worth knowing

- **Stop and resume** go through the chat: asking Stella to stop a task calls `stop_agent`, which halts it and its helpers at once, kills its running command's process tree, and keeps history and files; a later message to it (`send_message`) resumes it. There is no Stop button on rows.
- **Restarts.** Tasks survive a quit, an Update or a crash: they resume where they left off after the restart, the orchestrator gets one hidden "[Computer restarted]" note, and a Claude Code task cut off mid-command resumes with a prompt saying Stella restarted. A computer that stays away gets a hidden "[Computer offline]" note after 2 minutes; its tasks wait (up to 7 days) rather than fail.
- **Holds.** A Claude sign-in that ended holds turns with one "Waiting for you to sign in to Claude" notice and pauses tasks (`pausedBy: "claude-sign-in"`); a Claude usage limit shows a usage-limit card with Resume and pauses affected tasks.
- **Time limits.** A task's shell command runs up to 2 minutes in the foreground (10 at most), then continues in the background and wakes the task when it exits; every shell stops after 2 hours.
- **Reports.** Every turn end is a report unless the task waits; a run with no final text still reports what it last did. Reports are capped at 200,000 characters.

## Driving it

- Start a task with `chat send --text "<request that needs a background task>"`; the mark enables and the list shows the row. On a `--claude-login` run the task uses Haiku.
- Hold a task deterministically with a command that waits for a release file you create later (Haiku refuses a bare long `sleep`).
- Long-call row: hold one tool call past 12 minutes and check the meta line and `agent_status`.
- Paused by computer off: test copy A starts a task; take A away by stopping its recorded Electron tree by PID (not `cleanup apply`, which interrupts its tasks cleanly so they report instead of pausing); then launch copy B with `STELLA_VERIFY_ACCOUNT_EMAIL=<A's email>` and open B's activity list. Clean up A's run afterwards.
- Sign-in hold: a second copy without `--claude-login host` on the Claude Code engine shows "Waiting for you to sign in to Claude".
- Read the ledger with `backend-call.mjs view agentEvents.forThread '{"threadId":"…"}'` and a task's history with `call agentLogs.read`.

## Gotchas

- Activity rows on a cloud-synced chat come from the cloud ledger (`cloudThreadToTask` in `features/cloud/use-cloud-activity.ts`), not only local records.
- `cleanup apply` interrupts a copy's tasks cleanly, which is not the same as a computer going away.
- A finished lead whose helpers still work stays working; a helper waiting on the user no longer holds its lead's report.
