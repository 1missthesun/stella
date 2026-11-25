# Distributing the Rune engine

How `stella-engine` is built, shipped and started by the launchers. Nothing here is published;
installed Stellas keep starting Electron until the opt-in below is turned on by hand.

## Builds

`.github/workflows/build-rune-engine.yml` runs on every push to `rune/**` that touches
`packages/desktop-rune/**` or `launcher/**`.

| platform     | runner          | target                    |
|--------------|-----------------|---------------------------|
| linux-x64    | ubuntu-24.04    | x86_64-unknown-linux-gnu  |
| linux-arm64  | ubuntu-24.04-arm| aarch64-unknown-linux-gnu |
| darwin-arm64 | macos-15        | aarch64-apple-darwin      |
| darwin-x64   | macos-15        | x86_64-apple-darwin       |
| win-x64      | windows-2025    | x86_64-pc-windows-msvc    |
| win-arm64    | windows-11-arm  | aarch64-pc-windows-msvc   |

- Profile `dist` (thin LTO, one codegen unit, stripped). Each job uploads the artifact
  `stella-engine-<platform>` holding the binary, its `.sha256` and a `.json` with bytes, gzip
  bytes and build seconds; the job summary shows the same.
- Rune is a private git dependency (`github.com/1missthesun/rune`). CI reads it with the read-only
  deploy key `stella CI (read-only)` on that repo, stored as the Actions secret `RUNE_DEPLOY_KEY`
  on `1missthesun/stella`; git rewrites the https URL to ssh for that one repo.
- `launch (linux-x64)` starts the built binary on Xvfb with lavapipe and the TS host, waits for
  `first_content_frame` and uploads a screenshot and metrics (`stella-engine-linux-x64-launch`).
- `launcher compiles` builds the three launchers with the opt-in (compile only, nothing signed).
- Manual runs (`workflow_dispatch`, `profile: dist|release`) work once the workflow is on the
  default branch; until then push to a `rune/**` branch.

## Launcher opt-in

Electron stays the default. A launcher starts the engine instead when any of these is set:

- `--engine rune` (or `--engine electron` to force Electron),
- `STELLA_LAUNCHER_ENGINE=rune` in the launcher's environment,
- the file `<launcher root>/rune-engine` exists (`~/.local/share/stella/rune-engine`,
  `~/Library/Application Support/Stella/rune-engine` on the Mac's launcher root,
  `%LOCALAPPDATA%\Stella\rune-engine`),
- `--engine-bin <path>` / `STELLA_LAUNCHER_ENGINE_BIN=<path>`: a local engine binary (a CI
  artifact or `engine/target/dist/stella-engine`); implies rune.

What changes when it is on (Linux `stella-launcher.c`, Windows `stella-launcher.cpp`, macOS
`Launcher.swift` + `Install.swift`):

1. Install, verification, Bun, `bun install` and `prepare-install.mjs` run exactly as for Electron
   (the host runs master's Electron-main services, so it needs the same `node_modules`).
2. The engine is a versioned runtime like Bun: `packages/desktop/launcher.json` gains
   ```json
   "stellaEngine": { "version": "<v>", "assets": { "<platform>": { "url": "…", "sha256": "…", "member": "<path in zip, optional>" } } }
   ```
   and the launcher installs it to `<root>/runtimes/stella-engine-<v>/stella-engine[.exe]`
   (checksum-verified, GitHub URLs go through the releases mirror like Bun). An asset without
   `member` is the bare binary. `linux-x64-baseline` and `win-x64-baseline` use the x64 build.
   A source without `packages/desktop-rune/host/main.tsx` or without an asset for the platform
   fails with a clear message rather than falling back silently.
3. The launcher spawns `stella-engine` (no arguments, cwd = app source) with the usual Stella
   environment plus `STELLA_LAUNCHER_ENGINE=rune`, `STELLA_RUNE_ROOT=<app>/packages/desktop-rune`,
   `STELLA_RUNE_BUN=<runtimes>/bun-<v>/bun` and `STELLA_RUNE_SERVICES=1` (the host boots Stella's
   services, not the demo UI). The engine starts the TS host with that Bun.
4. The supervisor protocol is unchanged. On Linux and macOS the launcher's channel is fd 3, which
   the engine passes to the host (proven on Linux: the host process holds the launcher's
   socket on fd 3). On Windows the host connects to `STELLA_LAUNCHER_PIPE`; the pipe accepts the
   engine's direct child as well as the engine itself. Master's `launcher-client.ts`, running in
   the host, sends `ready` on the shim's `BrowserWindow` `ready-to-show`, and handles `quit` and
   `sign`, so the host track must emit those events from the `electron` shim. The engine must
   spawn the host with fd 3 inherited unchanged; the bridge pipes live elsewhere (fd 4/5).

Not done yet (ship-time work):

- Hosting: engine builds go to R2 `runtimes/stella-engine/<v>/` from a publish step, and
  `launcher.json` gets the `stellaEngine` entry. CI artifacts expire and need auth, so they are
  only for testing with `--engine-bin`.
- macOS identity: Electron runs inside a signed `Stella.app` (`ElectronIdentity`); the engine
  needs the same (a signed, notarized bundle so the Dock, menu bar, TCC prompts and notifications
  say Stella). Windows needs the engine Authenticode-signed with the launcher's certificate.
- Rune is private: an outside builder can't compile the engine until the mirror is public or the
  engine ships only as a binary.
- The Linux launcher's log is still `logs/electron.log` for both.
- User data: a launcher-started engine uses Electron Stella's userData and data dirs (same account,
  same files) but its own single-instance lock (`RuneSingleton.sock`), so Electron Stella and Rune
  Stella can run at once against the same data. One lock for both before anyone opts in.
- Proven on Linux (omarchy, Xvfb): `stella-launcher --self-test --engine-bin <dist engine>` clones
  the source, installs Bun and deps, starts the engine, gets `ready` 0.5-10 s after spawn, sends
  `quit`, gets `exiting 0`, exits 0; the runtime worker then stops by itself.
