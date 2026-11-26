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
- `launch (win-x64, WebView2)` builds master's native helpers, starts the engine and host
  services on the runner's desktop, opens a window and the WebView2 media page, plays audio,
  records the screen, reads input through the hook, runs meeting capture and uploads a
  screenshot (`stella-engine-win-x64-launch`).
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
- macOS media access (microphone, screen) needs that bundle; see "macOS bundle and media access".
- Rune is private: an outside builder can't compile the engine until the mirror is public or the
  engine ships only as a binary.
- The Linux launcher's log is still `logs/electron.log` for both.
- User data: a launcher-started engine uses Electron Stella's userData and data dirs (same account,
  same files) but its own single-instance lock (`RuneSingleton.sock`), so Electron Stella and Rune
  Stella can run at once against the same data. One lock for both before anyone opts in.
- Proven on Linux (omarchy, Xvfb): `stella-launcher --self-test --engine-bin <dist engine>` clones
  the source, installs Bun and deps, starts the engine, gets `ready` 0.5-10 s after spawn, sends
  `quit`, gets `exiting 0`, exits 0; the runtime worker then stops by itself.

## Linux: realtime voice needs a Chrome

Stock WebKitGTK has no WebRTC, so on Linux the voice media page runs in a headless Chrome or
Chromium started while voice is on (`host/media/chromium-media.ts`). The host takes the first of:
`STELLA_RUNE_CHROMIUM`; `~/.local/share/stella/runtimes/chrome/chrome`; the newest Chrome for
Testing the stella-browser CLI installed under `~/.stella-browser/browsers/chrome-<version>/`;
a system Chrome/Chromium (`/usr/bin/chromium`, `google-chrome-stable`, snap). With none of them,
voice reports that it cannot start; nothing downloads one for voice alone. Where Ubuntu's
AppArmor user-namespace restriction blocks Chromium's sandbox for that binary, the page is
started again with `--no-sandbox` (it loads only Stella's own page).

## Linux: media needs GStreamer plugins

Electron carries its own codecs; on Linux the engine plays `<video>`/`<audio>` through GStreamer
(Rune's `gstreamer` backend), as WebKitGTK does. The engine links `libgstreamer`, `libgstapp`,
`libgstvideo` and `libgstpbutils`, which WebKitGTK 4.1 already depends on (Arch
`gst-plugins-base-libs`, Debian `libgstreamer-plugins-base1.0-0`), so it adds no library. Decoding
needs the plugins: `gst-plugins-base` (Ogg, Vorbis, Theora, Opus, WAV), `gst-plugins-good`
(WebM/Matroska, MP4, VP8/VP9, FLAC) and `gst-libav` (H.264, HEVC, AAC, MP3). WebKitGTK lists the
same ones as optional, and desktop installs usually have them. A clip whose plugin is missing
fails with a message naming it and the package (`media.state` → `error`), and the viewer shows its
placeholder. Bundling plugins was rejected: they must match the system GStreamer's ABI and
registry, and they pull codec libraries (libvpx, FFmpeg) per distro. Routing decoding through the
on-demand voice Chromium was rejected too: it exists only while voice runs and draws no frames
into the engine.

Packages when Rune ships on Linux: the AUR package lists them as optional (`gst-plugins-good`,
`gst-libav`); the install script, which today installs only what the launcher's window needs,
should add `gst-plugins-good gst-libav` (pacman), `gstreamer1.0-plugins-good gstreamer1.0-libav`
(apt), `gstreamer1-plugins-good gstreamer1-plugin-libav` (dnf) or
`gstreamer-plugins-good gstreamer-plugins-libav` (zypper) once the launcher starts Rune by default.

## macOS bundle and media access

TCC decides microphone and screen access for the *responsible* process. The launcher spawns the
engine with responsibility disclaimed (`Supervisor.swift`), so the engine is responsible for
itself and for everything below it: the Bun host, the runtime worker, `mic_capture`, the media
WebView's WebContent process and ScreenCaptureKit streams. A bare `stella-engine` binary has no
Info.plist, and TCC kills a process that touches the microphone without a usage string. So until
the engine ships as a bundle, the host only reports access (`askForMediaAccess` returns the
current status and never prompts), and capture works only where some other app is responsible
(a run from Terminal or Stella).

The engine ships as `Stella.app/Contents/MacOS/stella-engine`, the same identity Electron Stella
has (`ElectronIdentity` in `Prepare.swift`, `build-electron-identity.yml`), so access already
granted to Stella carries over:

| Info.plist key | Value |
|---|---|
| `CFBundleIdentifier` | `com.stella.app` |
| `CFBundleExecutable` | `stella-engine` |
| `CFBundleName`, `CFBundleDisplayName` | `Stella` |
| `NSMicrophoneUsageDescription` | `ElectronIdentity.microphoneUsage` ("Stella uses your microphone for voice conversations and screen recordings.") |
| `NSSpeechRecognitionUsageDescription` | `ElectronIdentity.speechRecognitionUsage` |
| `LSMinimumSystemVersion` | `12.3` (ScreenCaptureKit) |
| `NSHighResolutionCapable` | `true` |

- Signing: Developer ID with the launcher's team, so the designated requirement is the one
  `ElectronIdentity.requirement` checks (`anchor apple generic and identifier "com.stella.app" and
  certificate leaf[subject.OU] = <team>`). TCC keys grants on that requirement: an ad-hoc or
  differently signed engine starts with no grants and prompts again.
- Hardened runtime: Electron's identity is signed without it (`codesign --deep`, no
  `--options runtime`) and is not notarized; the launcher downloads it without quarantine. If the
  engine is signed the same way it needs no entitlements. If it is signed with
  `--options runtime` (needed for notarization), it needs `com.apple.security.device.audio-input`
  (without it microphone access is refused without a prompt) and, if video capture is ever
  used, `com.apple.security.device.camera`. ScreenCaptureKit has no entitlement or usage string:
  it is the "Screen & System Audio Recording" grant, keyed to the same requirement.
  No JIT entitlements: the engine runs no JavaScript itself (Bun is a separate binary, WebKit's
  JIT runs in its own XPC processes).
- Screen recording: macOS 15 re-asks monthly ("continue to allow") for apps that capture without
  `SCContentSharingPicker`; the grant survives engine updates only while the requirement holds.
- Prompting: an engine whose executable sits in an `.app` bundle sets `STELLA_RUNE_MEDIA_PROMPTS=1`
  for the host (`spawn_ts` in `engine/src/main.rs`); a bare binary never does, because the alert
  would name whichever app launched it. With it, `systemPreferences.isTrustedAccessibilityClient(true)`
  shows macOS's Accessibility alert. `askForMediaAccess` still reports status only: asking for the
  microphone needs an engine command around `AVCaptureDevice requestAccessForMediaType:completionHandler:`
  (a block, so objc2 in the engine, not Bun FFI). Screen access is asked by master's
  `screen_permission` helper, which runs unchanged.

### Accessibility (ink, marks, global input)

Electron asks `systemPreferences.isTrustedAccessibilityClient` in its main process, so the grant
belongs to Stella.app. Under Rune the same call runs in the Bun host and goes to
`AXIsProcessTrustedWithOptions` over FFI (`host/electron/macos-media.ts`). TCC answers for the
responsible process, so everything below the engine counts as the engine: the host's check and
prompt, the engine's CGEventTap (`engine/src/inputhook.rs`), and the `stella_show` ink helper the
host spawns.

- The binary that needs the grant is `Stella.app/Contents/MacOS/stella-engine`, bundle id
  `com.stella.app`. Signed with the launcher team's requirement (above), a grant already given to
  Electron Stella carries over, so users are not asked again.
- The flow is Electron's, unchanged: Show Stella's controller checks `hasMacPermission("accessibility")`,
  asks once with `requestMacPermission("accessibility")` (the macOS alert), and opens
  `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` through
  `shell.openExternal`.
- Proof without changing System Settings (`accessibility-tcc-mac.txt`): the host's check returns
  true from a granted dev shell and false when the same Bun code runs under a fresh, never-granted
  bundle launched with `open`, with no alert shown.
