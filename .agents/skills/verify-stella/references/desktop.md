# Desktop harness reference

Consult this for launch options, account setup, diagnostic commands, and ownership mechanics. Command examples are a toolbox, not a required sequence. Choose evidence and coverage using SKILL.md.

## Desktop control utility

The canonical `/control-app` equivalent is:

```bash
node .agents/skills/verify-stella/control-stella.mjs help
node .agents/skills/verify-stella/control-stella.mjs capabilities
```

The `scripts/control-stella.mjs` file is a compatibility wrapper only. New map entries and agent workflows must use the root entry point.

The CLI uses grouped subcommands with machine-readable JSON. Named product journeys are optional convenience macros:

- `session` launches, checks, and describes the isolated app.
- `chat`, `nav`, `settings`, and `apps` encode repeatable Stella journeys (`chat ready|send|state`, `nav home|files|browser|open`, `settings open|tab|search|state|close`, `apps open|state|ask`).
- `inspect` captures semantic state, components, ARIA, screenshots, and an explicit unsafe eval escape hatch.
- `drive` performs accessible clicks, fills, key chords, scrolling, waits, and settle detection.
- `performance` captures metrics, traces, and CPU profiles.
- `diagnostics` captures owned logs and bounded redacted console/network events.
- `cleanup` previews and applies exact helper-owned teardown.

Use `capabilities` rather than parsing help when an agent needs discovery; it lists each command's `usage`, accepted `flags`, boolean `switches`, and whether a `positional` value is allowed. `<group> <command> --help` prints the same for one command. Unknown options and unexpected positional arguments are rejected with `USAGE` before anything runs.

Every command except `help` and `<command> --help` writes exactly one JSON envelope: `{ok: true, command, data, meta: {schemaVersion, runId, elapsedMs}}` on stdout, or `{ok: false, command, error: {code, message, recovery, retryable}}` on stderr with a non-zero exit. `ok: true` means the command ran, not that the product passed: `session doctor` and `chat ready` return their verdict in `data` (`data.ok`, `data.ready`) and exit 2 when it is negative, and `chat send` exits 2 on `no-new-evidence`. `inspect eval` returns `data.value`. Argument errors carry `code: USAGE` and point to the command's `--help`. Potentially destructive cleanup supports `--dry-run` and also has a dedicated `cleanup plan` command.

Numeric ranges: `chat send --timeout` 500-120000 ms (default 10000); `drive settle --quiet` 100-5000 and `--timeout` up to 13000; `drive wait --timeout` default 10000; `performance trace|profile --duration` 250-10000; `diagnostics console|network-* --duration` 100-10000. `drive scroll [--selector <CSS>] [--x <px>] [--y <px>]` scrolls the document, or the element matched by `--selector`, by that offset and reports `moved` and `scrollable`; target the actual scroll container (Settings content scrolls in `.settings-panel`, not the tabpanel).

## Desktop launch and doctor

From the repository root, with dependencies installed (`bun run deps desktop`, plus `backend` when the claim needs your own Preview; a worktree has none until you run it) and the gitignored `workers/cloud-builder/.dev.vars` present (copy it from the main checkout into a fresh worktree, mode 600, and delete it with the worktree). `cloud-turn.mjs` needs no install. Launch refuses (`INSTALLED_APP_CHECKOUT`) when this checkout shares git data with an installed Stella (`$STELLA_APP_DIR`, `~/.local/share/stella/app`, `~/Library/Application Support/Stella/app`, `%LOCALAPPDATA%\Stella\app`), since a test copy there rewrites the install's update refs. On Linux, launch starts a private Xvfb for the run on the first free display from `:90` (system `Xvfb`, `STELLA_VERIFY_XVFB`, or one `scripts/fetch-xvfb.sh` unpacks into `~/.cache/stella-verify/xvfb` from the pacman mirror without root) and runs Electron with software GL there, so no window reaches the user's screen and nothing competes with other runs. The run record's `display` says which; `--display host` puts the window on the real `DISPLAY`, and `--display xvfb` fails instead of falling back. Never start an Xvfb by hand with `-displayfd` or on a low display number: on Hyprland it can take over `:0`, the display the user's own X11 apps use. On macOS the window opens on the visible desktop. Read geometry from a fresh observation rather than assuming a size:

```bash
node .agents/skills/verify-stella/control-stella.mjs session launch
node .agents/skills/verify-stella/control-stella.mjs session doctor
```

Pass `--replace` only after inspecting `cleanup plan` when a stale verifier run is recorded.

`session relaunch` quits the recorded Electron, stops the run's detached runtime worker (otherwise the new window attaches to the old worker and runtime or engine edits never load) and the test browser, and starts them again on the same data directory, Chromium profile and account (a test account is re-minted for the same email; a signed-out run stays signed out), so claims about state surviving a restart can be checked. Fixture state that must be on disk before the app reads it (for example entries in the run's `data/ui-state.json`) can be written after stopping the recorded `electronPid` and before relaunching; the main process rewrites that file while it runs.

One run per checkout is recorded in `.run/current.json`. Agents sharing a checkout keep separate runs with `STELLA_VERIFY_RUN=<name>` (1-32 of `a-z0-9-`) on every command, including `backend-call.mjs`; each gets `.run/current-<name>.json`, its own display, ports and data. `ALREADY_RUNNING` without it means a run is already recorded: drive it only if it is yours.

Launch signs in a test account by default (`--account signed-in`); pass `--account plus`, `--account pro` or `--account max` for that plan, unlimited (minted per run at `agent-<runId>@test.stella.local` through the dev backend's admin API; targets `STELLA_BACKEND_URL` (default: the dev cloud-builder worker) and needs `STELLA_ADMIN_API_SECRET`, read from the gitignored `workers/cloud-builder/.dev.vars` when not exported). `STELLA_VERIFY_METERED=1` makes a paid account metered on its plan's budget instead, and `STELLA_VERIFY_ALLOWANCE=spent` launches it with its budget used up (both also apply on `session relaunch`). The run record and `session info` report `account.mode`, `account.ownerId`, and `account.email`; the bearer is handed to Electron only through its environment and never written to disk.

On macOS, privacy prompts (Speech Recognition, Microphone, Screen Recording) are charged to the app responsible for the process, and a run started from an agent's shell inherits the user's own Stella. Pass `--own-app-identity` for any claim that touches one: the run uses a cached copy of Electron.app named "Stella Verify" (`com.stella.app.verify`, ad-hoc signed, in `~/Library/Caches/stella-verify-identity/`) launched with responsibility disclaimed, so prompts and grants belong to it and never to the user's Stella. A grant survives later runs of the same Electron version; `tccutil reset <Service> com.stella.app.verify` clears it. Answer its prompts through the `UserNotificationCenter` app with computer use.

Pass `--account signed-out` to boot with no account at all: Stella has no guest accounts, so the app shows onboarding (with `--first-run`) or the sign-in screen and nothing that needs an account works until you sign in. Pass `--first-run` to skip seeding onboarding complete, so the window opens on first-run onboarding; combine it with `--account signed-out` to prove a fresh install.

Electron and the test Chromium start with `--mute-audio` so a test copy never plays sound on the user's speakers (message sounds, read-aloud, voice, agent tabs); `--audible` launches with sound for a claim about audio, and relaunch keeps the run's choice.

Launch creates an isolated run under `.agents/skills/verify-stella/.run/<runId>/`, an isolated durable Stella data directory, and a temporary Chromium user-data directory. It seeds onboarding complete (unless `--first-run`), allocates an ephemeral CDP port, and launches Electron from source (`electron <repo> --dev`) with `STELLA_DEV_HARNESS=1` and an allow-listed environment; there is no Vite or other dev server, and main/preload rebuild themselves when stale. Electron output goes to the owned `electron.log`. It preserves protected-storage behavior with a run-scoped key rather than using the developer's keyring; the key is kept in the run directory (`protected-storage.key`, owner-only) so `session relaunch` can still read what the run encrypted, including the device signing key. A launch takes a few seconds; the active conversation id can appear a moment after `session doctor` first passes, so retry `chat ready` once before treating `ready: false` as a failure.

The temporary Chromium profile, the runtime IPC directory and, on macOS, the agent browser's socket directory (`STELLA_BROWSER_SOCKET_DIR=<tmp>/stella-verify-<runId>/b`; under the run's home its socket path passes the limit and the agent's browser never starts) (`STELLA_RUNTIME_IPC_DIR`) live under `<tmp>/stella-verify-<runId>/`. On macOS, `<tmp>` is `/tmp/sv` and Electron's `TMPDIR` is shortened to it too: the per-user `/var/folders/.../T` path pushes the runtime and CLI-bridge Unix sockets (`<ipc>/stella-<uid>/<hash>/r.sock`, `<ipc>/stella-<uid>/<hash>/<nonce>/b.sock`) and Chromium's singleton socket past the 104-byte `sun_path` limit. Other platforms use the system temp directory.

### What the run shares with the host

Isolated per run: the home directory (`HOME` is `.run/<runId>/home`, whose `.stella` links to the run's data directory, so an agent's `~/.stella/memories`, `~/.stella/outputs` or any `~` path, and onboarding's browser and project discovery, stay inside the run; git gets a `.gitconfig` with the host's name and email; the bun package cache and mise stay shared through `BUN_INSTALL_CACHE_DIR`, `MISE_DATA_DIR` and `MISE_GLOBAL_CONFIG_FILE`), the Stella data directory (`~/.stella` equivalent: conversations, preferences, ChatGPT and API-key credentials, connectors), Electron user data and Chromium profile, protected storage (a run-scoped key, not the OS keyring), saved secure values (`STELLA_SAVED_VALUES_STORE=protected_file`, so `request_secure_input` answers never reach the login keychain), the runtime IPC sockets, the browser bridge (unless `--browser-bridge shared`), and the Claude Code and Codex CLI configs (`CLAUDE_CONFIG_DIR` and `CODEX_HOME` point at `.run/<runId>/provider-homes/`, so a fresh run shows "Claude Code on this computer isn't signed in"). Electron gets only an allow-listed environment, so host API keys and tokens in the shell do not reach it.

On Linux, Electron also starts under `bwrap` with the run's data directory mounted over the real `~/.stella`, so an agent that writes an absolute real-home path (models expand `~` themselves; on 2026-10-13 two report agents wrote the real `~/.stella/outputs`) lands in the run; `session info` shows `homeJail` (`on`, or why not), launch warns when it is off, and `STELLA_VERIFY_HOME_JAIL=0` disables it. Agents' prompts also state the absolute `~` and `~/.stella`.

Shared with the host: the OS user (on macOS, and outside `~/.stella` on Linux, absolute paths still reach the real home; `os.userInfo()` and other passwd lookups return the real home), the CLIs on `PATH`, the display and `XDG_RUNTIME_DIR`, and the network. Runs launched before 2026-10-12 used the real home: an agent in one wrote test data into the user's real `~/.stella/memories`, which synced to the user's cloud account. Relaunch adds the private home to such a run. On macOS, a CLI that keys the keychain by config directory stays isolated; anything that reads a fixed keychain item does not. Some copy is hard-coded for macOS ("this Mac" in Cloud Home import and Locked computer use) and appears on Linux too; it is not leaked state. Runs before this change saw the host's default Claude Code login.

The harness runs an isolated browser bridge by default, so the user's Chrome extension cannot reach it and the Browser panel offers "Use my browser's logins". `--browser-extension` pairs the run with a private extension instead: launch copies `packages/stella-browser/extension` into the run with its bridge port patched, writes a native-messaging host into a private Chromium profile pointing at this run's bridge socket directory, sets `STELLA_BROWSER_ISOLATED_EXT_PORT` and `STELLA_BROWSER_SOCKET_DIR` for Electron, and starts Chromium on the run's display with only that extension loaded. The panel then shows the connected state ("Sites open with your browser's logins"), and the extension's cookie import and tab control run against that Chromium profile, so sign in there for logins a claim needs. The record's `browserExtension` has the Chromium pid, profile and port; relaunch and cleanup restart and stop it; relaunch also copies the extension again, so edits to it load. That Chromium listens for DevTools on a free port, written to `DevToolsActivePort` in its profile, so tabs, tab groups and the extension's service worker can be inspected over CDP. It needs Chromium (system, Playwright's, or `STELLA_VERIFY_CHROMIUM`): Google Chrome ignores `--load-extension`. Not on Windows. `--browser-bridge shared` sets `STELLA_BROWSER_BRIDGE=shared`, which claims the per-user shared bridge (fixed extension port and native-messaging host) from any running Stella, including the user's installed app and other agents' runs. Use it only for a claim about the user's own Chrome, after asking; relaunching the installed app reclaims it.

`--claude-login host` writes this computer's newest Claude Code access token (from `$CLAUDE_CONFIG_DIR`, `~/.claude`, or the macOS keychain) into the run's `provider-homes/claude/.credentials.json` with no refresh token, and reports `claudeLogin.status` from `claude auth status` in that directory. It refuses a token with under 30 minutes left (run any `claude` command to refresh it). `--claude-login token` writes `STELLA_VERIFY_CLAUDE_OAUTH_TOKEN` (environment or `.dev.vars`) instead. Cleanup deletes the file. On macOS the CLI may keep reading its keychain item for that config dir; trust `claudeLogin.status.loggedIn`, not the flag.

Stella keeps Claude Code updated in the background (`claude update` shortly after start, then twice a day). A run turns that off (`STELLA_CLAUDE_CLI_UPDATES=off`), because it shares the host's `claude` but has its own home, where the updater would install a second copy. For a claim about updating, install an old copy into the run's home (`HOME=<homeDir> CLAUDE_CONFIG_DIR=<providerHomes.CLAUDE_CONFIG_DIR> claude install <version>`), then `session relaunch` with `STELLA_CLAUDE_CLI_PATH=<homeDir>/.local/bin/claude STELLA_CLAUDE_CLI_UPDATES=on`; the outcome lands in `<dataDir>/claude-cli-updates.json` and the process log (`claude-cli.update-*`). Never downgrade the host's own install.

The optional `--model-gateway <origin>` overrides gateway discovery for a specific
deployment; omit it to verify discovery from the signed-in catalog.

Doctor exits successfully only when the recorded Electron process is alive, CDP has Stella's full-window page target (`index.html?window=full`; the run also exposes `overlay.html?window=overlay` and, when enabled, the two companion targets), the full-window top bar `.shell-topbar-full` exists, Electron device identity is available, and the runtime worker answers a request (the model catalog, which main serves only from a connected runtime worker). A painted shell alone is not healthy.

Never attach by process name or window title. The pointer under `.run/current.json` is the ownership boundary.

## Desktop journeys

Examples of the intended high-level interface:

```bash
node .agents/skills/verify-stella/control-stella.mjs chat ready
node .agents/skills/verify-stella/control-stella.mjs chat send --text "list open tasks"
node .agents/skills/verify-stella/control-stella.mjs nav home
node .agents/skills/verify-stella/control-stella.mjs nav files
node .agents/skills/verify-stella/control-stella.mjs nav open --name Schedule
node .agents/skills/verify-stella/control-stella.mjs settings open
node .agents/skills/verify-stella/control-stella.mjs settings tab --name "Shortcuts"
node .agents/skills/verify-stella/control-stella.mjs settings search --query language
node .agents/skills/verify-stella/control-stella.mjs apps open
node .agents/skills/verify-stella/control-stella.mjs apps state
```

Use lower-level commands when a feature has no named journey:

```bash
node .agents/skills/verify-stella/control-stella.mjs inspect components
node .agents/skills/verify-stella/control-stella.mjs drive click --role button --name "Open" --within .shell-topbar-full
node .agents/skills/verify-stella/control-stella.mjs drive click --role tab --name "Chat (⌘1)"
node .agents/skills/verify-stella/control-stella.mjs drive fill --placeholder "Do anything" --value "draft"
node .agents/skills/verify-stella/control-stella.mjs drive press --key Shift+Enter
node .agents/skills/verify-stella/control-stella.mjs drive press --key Control+KeyT
node .agents/skills/verify-stella/control-stella.mjs drive settle
```

The desktop is a single-chat product. The full-window top bar (`.shell-topbar-full`) has, left to right: the `Tabs` tablist (the pinned **Chat (⌘1)** tab, then one tab per open place, file or app, each with `Close <title>`), the **Open** (+, ⌘T) button whose menu has `Search anything` and the places Files, Apps, Browser, Schedule, Email, Updates (only in a git-checkout install) and Trash; the centred **Activity** mark (disabled unless a task is running or paused); then **Where Stella works** (computer icon: This computer / Cloud), **Notifications** (bell), **Models**, and the ⚙ **Account** button (its accessible name is the account's nickname or `Account`; signed out it is **Sign in** plus a `Settings` gear). A non-Chat tab shows on the stage, a layer over the chat between the top bar and the composer; the composer stays usable. There is no conversation history or New chat control; the active conversation comes from the root route (`?c=`). A fresh `session launch` is the way to get an empty conversation. See [top bar and tabs](../features/top-bar-and-tabs.md).

Use current observations to choose roles, accessible names, placeholders, or a suitable named journey. Use `drive click-xy` only after a fresh `inspect components` identifies the viewport geometry. Use `inspect eval --js` only when the CLI and feature map lack a safe observable. Never use eval to mutate product state as a substitute for a user path.

## Desktop evidence and diagnosis

Store proof in the run's `evidenceDir` (`session info`): `~/.stella/outputs/verify-stella/<runId>/` when `~/.stella/outputs` exists, else `artifacts/` in this folder; `STELLA_VERIFY_EVIDENCE_DIR` overrides the root. Cleanup preserves it. Paths below are examples.

```bash
E=$(node .agents/skills/verify-stella/control-stella.mjs session info | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.evidenceDir')
node .agents/skills/verify-stella/control-stella.mjs inspect aria --path "$E"/settings-open.aria.txt
node .agents/skills/verify-stella/control-stella.mjs inspect screenshot --path "$E"/settings-open.png
node .agents/skills/verify-stella/control-stella.mjs diagnostics logs --tail 300
node .agents/skills/verify-stella/control-stella.mjs diagnostics console --duration 2000
node .agents/skills/verify-stella/control-stella.mjs diagnostics network-summary --duration 2000
node .agents/skills/verify-stella/control-stella.mjs performance metrics
node .agents/skills/verify-stella/control-stella.mjs performance trace --duration 3000 --path "$E"/perf-trace.json
node .agents/skills/verify-stella/control-stella.mjs performance profile --duration 3000 --path "$E"/perf-profile.json
```

Proof must show the action and resulting state in the Electron window. A screenshot of an idle shell, a successful build, or direct internal state manipulation is not UI proof. For a mutation, read the value back through another visible state or the isolated persisted data. A missing model provider may yield a visible send error; do not hang waiting for output.

Keep diagnostics bounded. Console and network capture redact obvious secret material and avoid response bodies, but artifacts still require review before sharing.

## Desktop cleanup

```bash
node .agents/skills/verify-stella/control-stella.mjs cleanup plan
node .agents/skills/verify-stella/control-stella.mjs cleanup apply --dry-run
node .agents/skills/verify-stella/control-stella.mjs cleanup apply
```

`cleanup apply` (alias `stop`) is the only way to stop a run; the `session` group has no stop command. It stops the copy's tasks cleanly (they report interrupted).

Cleanup targets only what the run recorded: the Electron PID (its process group), the test Chromium, the run's Xvfb, processes whose command line carries the run's own `stella-verify-<runId>` path (the detached Bun runtime worker, Electron helpers, crashpad), a borrowed Claude login, the verifier pointer, and the temporary Chromium profile. It preserves the isolated durable data and proof artifacts. A stored PID is signalled only while it is still the process the run recorded (same start time, or for older records the run marker or its own arguments), never on the PID alone, and every signal sent or refused is logged with its target's command and reason to `~/.stella/logs/process-kills.log` (`cli/process-safety.mjs`). Do not kill by process name or a broad `pkill -f` pattern; the developer's own Stella shares the `stella-v2` window class, and a pattern that matches your own shell kills it.


## Recipes that come up often

- **Renderer edits.** A run serves the renderer from source with no HMR: `session relaunch` loads edits (it re-mints the account, so re-apply a Free plan through `backend-call.mjs` afterwards). `inspect eval --js 'location.reload()'` reloads the full window only; reloading the hidden overlay window leaves voice unmounted until a relaunch.
- **Window size and theme.** `inspect eval --js 'window.resizeTo(760, 700)'` resizes the test window (check top-bar changes near 760px too: tabs go icon-only and the strip scrolls). Light or dark: set `"stella-color-mode": "light"|"dark"` in the run's `data/ui-state.json`; the app picks it up live.
- **Real pointer input.** Drags, hovers and native-feeling clicks go through CDP `Input.dispatchMouseEvent` on the run's `cdpPort`. Hover-only controls (Schedule row actions) are invisible to `drive click`; use `drive click-xy` from their rect.
- **Main process.** Launch or relaunch with `STELLA_VERIFY_INSPECT_MAIN=<port>` for a Node inspector on Electron main; `require` is unavailable in eval there, `process._linkedBinding("electron_browser_app").app` reaches `app`, and evidence of renderer hangs is in the main log (`main.renderer-stall|busy|health|gone`).
- **After an in-app Update.** The recorded `electronPid` is stale once Update relaunches the app; `session relaunch` then kills the live renderer. Stop the run and launch again (or write the live main PID into the pointer and `run.json` first).
- **Updates tab in a test copy.** A run from a git checkout lists that checkout's own recent commits under Updates › History without **Undo**; undo is refused there unless `STELLA_APP_SOURCE_UNDO=1` (set by `update-bench` for its sandbox). Press Update only in an `update-bench` sandbox.
- **Engine edge cases.** `STELLA_CLAUDE_CLI_PATH=/nonexistent/claude` at launch shows "Claude Code not installed"; a Bun other than the bundled one runs when its directory is first on `PATH` at launch (the env allow-list drops `STELLA_BUN_PATH`).
- **Fixtures for agents.** On Linux the run's `$HOME` is jailed: fixture scripts that a test task runs must use absolute paths outside `~/.stella` (also for `--fake-mic` WAVs). Haiku refuses a bare `sleep 900`; hold a task with a loop that waits for a release file.
- **Two computers, one account.** Launch two runs with different `STELLA_VERIFY_RUN` names and the same `STELLA_VERIFY_ACCOUNT_EMAIL`. "Allow work from your other devices?" must be allowed on the computer that runs placed work, else sends fall back to the cloud; `backend-call.mjs call devices.setBrainHome '{"deviceId":"…"}'` pins which computer holds the chat. On Linux the second run's recorded `electronPid` is its `bwrap` wrapper; take a computer "off" by stopping that wrapper's own tree.

## Observation and interaction results

`inspect observe --path <directory> [--since <observation.json>]` writes uniquely named JSON, PNG, and Chromium accessibility-tree text artifacts. It returns state, controls, accessibility, paths, and capture timestamps. The samples are sequential; use timing tools for animation or races. Comparisons require the same run and report changed state fields, added/removed controls (including geometry changes), and whether the accessibility tree changed. Controls use light-DOM discovery; the screenshot and accessibility tree can reveal additional surfaces. The older `inspect aria` command remains a DOM-derived outline.

`drive click` and `drive fill` require a unique visible match. On ambiguity they return `AMBIGUOUS_TARGET`, the total match count, and up to 20 candidates with labels and geometry. Narrow the target with `--within <CSS scope>` or `--selector`; inspection and targeting share name/role handling. `drive wait` checks existence and permits multiple matches.

`nav home` checks the automatic Home overlay and fails with `APP_NOT_READY` when it is not showing; it never creates a conversation.

`drive settle` waits for a quiet DOM interval. Mutations inside `svg[aria-hidden="true"]` are ignored because the top-bar Stella mark and working indicator animate continuously; pass `--ignore <CSS>` to exclude another known-decorative region. The result reports how many mutations it ignored.

`apps open`, `nav files`, `nav browser` and `nav open --name <place>` click the top bar's **Open** (+) button and the place in its menu, then wait until that tab is selected on the stage. Files root, Apps list and Browser allow one empty tab and Schedule, Email and Updates one tab each, so repeating a call reselects the tab. A transient menu or dialog left open (account menu, Models) can cover the + menu; press Escape first.

`inspect state` (and every macro's state) reports `homeOpen` (the empty-conversation Home overlay), `settingsOpen`, `stageOpen` (a non-Chat tab is showing), `activeTab` (the selected top-bar tab's name, null while a dialog makes the bar inert), `selectedTabs` (every visible selected tab, Settings tabs included), the composer, and the active conversation id.

`chat send` uses the Home composer while the chat layer is obscured and observes new messages after the overlay closes. It reports `action: enter-dispatched`, plus `observation: new-user-message`, `new-notice`, or `no-new-evidence`. It compares message IDs and notices in the active conversation against the pre-send state. Timeout returns observations with exit code 2. A new notice is not classified as a provider error; a visible user message does not prove backend acceptance or assistant completion. `responseCompletion` is explicitly `not-assessed`.

`settings open|tab|state|close` return the shell state (`settingsOpen`, `selectedTabs`, composer), not the dialog's contents; `settings search` also returns the result text. Read dialog contents with `inspect observe`, `inspect components`, or a screenshot. Settings has no Stella plan field and the top-bar Account button shows no plan: read it under the Account menu's **Plan & usage** ("CURRENT PLAN"). Clicking a Settings search result switches to its tab but does not scroll to the section; scroll `.settings-panel`.

`apps open` and `apps state` return bounded surface text with `classification: not-assessed`; the previous inferred `state` field is removed. `chat send` no longer returns the broad page-text `providerErrorVisible` guess. `ok` means the command ran, not that the feature passed. Text redaction is best-effort and screenshots are unredacted; review artifacts before sharing.
