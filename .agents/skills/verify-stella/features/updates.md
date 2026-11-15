# Updates, drafts and Undo

Stella runs from source and changes itself: new versions from the Stella team, changes the user made on another computer, and drafts its own tasks make (the modify-stella skill) all arrive as Updates. One Update applies to every computer on the account.

## Surfaces

- **Update pill** in the top bar (`shell/ShellTopBarUpdatePill.tsx`) while something is waiting; a version that needs a restart holds while a reply is running ("After Stella's reply", at most 3 minutes) or a recording is going ("After your recording"), but never waits for tasks: they resume after the restart.
- **Updates tab** (+ menu › Updates, only when Stella runs from a git checkout; `shell/sidebar-sections/UpdatesSection.tsx`): **Waiting** ("Nothing waiting" / "You're up to date") with "New version of Stella", "A change you made on <computer>" (**Get** / **Skip**), "A change ready to add" (**Add**); **History** with **Undo** per entry (installed app only) ("Updated from <computer> …", "Undone …"). When this computer's own changes can't reach the others (they clash, or Stella wouldn't build with them) a note says so.
- **Device choice** on Update: "Update all your computers" / "Update this computer only" / "Choose computers"; an offline computer "Gets it when it's back on".
- **Bell** items: other-computer change (Get), arrived version (Undo), update that overlaps the user's changes ("This update overlaps your changes": merged before it is offered; when unsure "A task merges them when you update", and on Free "Merging them uses some of your free allowance").
- **Drafts**: a finished draft that touches only `packages/desktop-ui/src` adds itself once the user is quiet for 1.5 s or the window is unfocused, swapping in place when it can (only declarations reload) and otherwise reloading covered; a draft the window refuses is undone and its task is told. Other drafts wait for the Update button. The in-chat Update/Undo card needs the draft tied to its task.

## Driving it

- Time an Update end to end with `scripts/update-bench.mjs` (sandbox clone of dev upstream + this harness; renderer, main, runtime, dependency, stale-draft and undo cases; `help` lists commands).
- Two computers: two sandboxes cloned from the same upstream, launched with the same `STELLA_VERIFY_ACCOUNT_EMAIL` and different `STELLA_VERIFY_RUN`; a `draft/*` branch in one that touches only desktop-ui adds itself and the other gets a **Get** item within about 10 s.
- Release-style test: your own Preview with its artifacts namespace swapped to a test namespace, publish the previous prod sha there, clone + launch, publish the new sha, press Update.
- Test what installs get with `STELLA_RENDERER_MODE=production` on relaunch (runs serve the dev renderer otherwise).

## Gotchas

- A copy running from a developer checkout (no launcher) lists that checkout's commits under History with no **Undo**, and `appSource.undo` refuses (`reason: "unavailable"`), so it can't rewrite the working tree. The update-bench sandbox stands in for an install with `STELLA_APP_SOURCE_UNDO=1` (passed through by the harness); press Update/Undo only there.
- Never launch a test copy from the installed app's checkout or a worktree of it (the harness refuses): its sync rewrites the install's update refs.
- After an Update relaunch the harness's recorded PID is stale and `cleanup apply` misses the new Electron main; stop it by its exact PID (find it by the sandbox path).
- Failure reasons are worded in the window (`shell.appSource.failure.*`), raw text only behind "Details"; app-source events are in `~/.stella/logs/<id>/process-*.txt` (`app-source.*`).
