# Claude Code engine

Stella can run its chat and tasks on the user's own Claude Code (their claude.ai login) instead of Stella's managed models. Engines mix per agent on every host: a Claude Code orchestrator can start tasks on any model and the other way round. Claude Code is an unmodified CLI on each computer (and in cloud containers for cloud Claude tasks); full sessions sync to the cloud per step.

## Entry points

- **Models** › **Claude Code** group in the top bar (picking it switches the engine); onboarding's "Choose your AI"; Settings › Account for logins.
- Install: one click everywhere (onboarding, Settings, the chat notice, the connect-plan card) runs Anthropic's installer into the home folder with progress (`desktop/electron/services/claude-cli-install.ts`, UI `features/claude/use-claude-cli-install.ts`). A send on Claude Code without the CLI shows a plain bubble and an install notice.

## Behavior worth knowing

- **Plain tool names.** Stella's tools reach Claude Code over the CLI's stdin/stdout control channel as an SDK MCP server with no `mcp__` prefix (`CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1`; names in `packages/contracts/claude-code-tool-names.ts`). Tools that collide with built-ins are renamed (`read_file`, `edit_file`, `write_file`, `shell`, `search_files`, `find_files`; only cloud Claude tasks hit these). Old sessions resume through `toolAliases` from `mcp__stella__<name>`.
- **Auto-update.** Desktop main runs `claude update` about 90 s after start and every 12 hours (1 hour after a failure), silently (`services/cli-updater.ts`, state `<data>/claude-cli-updates.json`, log `claude-cli.update-*`); it honours `DISABLE_AUTOUPDATER` and leaves Homebrew/WinGet/apt installs to their package manager. A session whose binary changed restarts with `--resume` on its next turn, never mid-turn. Test copies turn the updater off (`STELLA_CLAUDE_CLI_UPDATES=off`); the desktop reference has the recipe for testing it.
- **Logins end** a fixed ~4 weeks after `claude auth login`. A heads-up goes to the bell 3 days before; after the end, turns hold with one "Waiting for you to sign in to Claude" notice and send once signed in; tasks pause (`pausedBy: "claude-sign-in"`). Transient Anthropic errors (5xx, Cloudflare 403s) retry and are never treated as a sign-out.
- **Usage limits** pause the reply or task with a usage-limit card and Resume; they resume by themselves at the reset.
- **Restarts.** A turn cut off by quit, Update or a dead worker resumes with a prompt saying Stella restarted; Claude Code's own synthetic "No response requested." is never shown (see the silent marker in [chat](./chat.md)).
- Stella's tools over MCP end after 30 minutes except `ask_user` and `request_secure_input`; the desktop orchestrator runs with cwd `~/.stella` and `--setting-sources ""` (no CLAUDE.md).

## Driving it

- `session launch --claude-login host` (or `token`) for a real local turn; the run starts on Claude Code with Haiku. It spends the user's Claude quota.
- Cloud Claude on dev needs no sign-in: `cloud-turn.mjs --engine anthropic --model claude-sonnet-4-6 --prompt "Reply with exactly: ok"` (see the cloud reference).
- Ended login: edit only the run's `provider-homes/claude/.credentials.json`. Usage limit: put a `claude` wrapper first on `PATH` that proxies the real CLI and prints `Claude AI usage limit reached|<epoch>` while a flag file exists.
- Not installed: `STELLA_CLAUDE_CLI_PATH=/nonexistent/claude`.

## Gotchas

- On omarchy `~/.claude` may hold an ended login; `--claude-login host` then fails or hits a limit. Use `--claude-login token` with your own config dir's access token.
- On macOS the CLI reads its login from the keychain item for the exact `CLAUDE_CONFIG_DIR` string; trust `claudeLogin.status.loggedIn`, not the file.
- `session relaunch` resets a `--claude-login` run's model to Haiku.
