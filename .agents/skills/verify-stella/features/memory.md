# Memory

Stella's memory is plain Markdown under `~/.stella/memories/`, synced through the account so every computer and the cloud see the same files.

## Layout and who reads what

- `main.md`: loaded into the orchestrator's context every turn (with a budget; past it, it is cut off and Stella is told).
- `rules.md`: the user's standing rules, 6k cap, written only by Stella. It reaches every task and helper on every host as the resident "standing-rules" section (`packages/agent/src/stella/standing-rules.ts`; cloud pi via `pi-runtime`, cloud Claude Code via `build-session/agent-rules.ts`). Memory off means no rules.
- `areas/<area>.md`: per-area memory a task is pointed at in its brief; nothing loads it automatically.
- `archive/`: read by nothing.
- Agents use `memory.read/list/write` in `code` (paths relative to `~/.stella`, `expectSha` for safe writes); `memory.write` caps a file at 32,000 characters. The orchestrator prompt says what memory is for, not how to save (`packages/runtime/extensions/stella-runtime/agent-metadata/orchestrator.md`).

There is no built-in memory tidy job; any periodic clean-up is a schedule on the user's account.

## Sync

- Files up to 512 KB sync (`MEMORY_SYNC_MAX_BYTES`). Over that, the write tool result and Claude Code's PostToolUse note it, the bell says "Some memory isn't syncing", and refused files retry every 6 hours.
- Sync never destroys an uninspected local version: displaced edits go to `<data>/memory-sync/conflicts/` and a merge task.
- Signed out, memory is on by default; memory written signed out waits for the keep-or-sync choice after sign-in (sync held while the signed-out marker is set or after "Keep").
- Settings › Privacy has the **Memory** switch; Cloud Home settings (phone and desktop) cover re-importing and wiping cloud memory.

## Driving it

- A test copy's `~/.stella` is the run's data folder (mounted over the real path on Linux), so a task's memory writes land in `.run/<runId>/data/memories/`. Read them there; never point a test task at the real `~/.stella`.
- Prove a rule reaches tasks: write `memories/rules.md` in the run's data, start a task, and check its first turn obeys it (or read the task's prompt section in `agentLogs.read`).
- Sync size limits: write an over-512 KB file through a task and look for the bell item and the tool-result note.
- Memory prompt changes are prompt experiments: Opus only, and see "Testing prompt changes" in SKILL.md.

## Gotchas

- `MEMORY_FILE_MAX_CHARS` (32,000) is only `memory.write`'s curation cap, not a sync limit.
- Haiku copies chat-stated rules into nearly every brief; Opus and GPT-6 Luna keep them out. Judge brief behavior on the model in question.
