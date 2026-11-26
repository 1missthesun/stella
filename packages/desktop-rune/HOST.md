# Host services: Electron main on Bun

The host is one Bun process. With `STELLA_RUNE_SERVICES=1`, `host/main.tsx` boots master's
Electron main (`packages/desktop/electron`, unchanged) under an `electron` module served from
`host/electron`, then loads the UI over it:

1. `services/stdio.ts` (first import): every console method and `process.stdout` go to stderr.
   Bun writes `console.debug`, `dir`, `table` and others to stdout, which is the engine bridge.
2. `services/ui-env.ts`: desktop-ui's `VITE_*` env, read with master's `loadRendererEnv`.
3. The UI builder child is warmed (`services/ui-loader.ts`).
4. `services/boot.ts` → `electron-main.ts`:
   - attaches the engine bridge, configures `app`, installs the plugin (`electron/plugin.ts`);
   - imports `packages/desktop/electron/main.ts` and fires `ready`.
   Electron main then does what it does in Electron: data dirs, logging, auth, the runtime worker,
   app-source, schedules, IPC handlers, its windows.
5. `boot.ts` waits for the first app window, then sets up its DOM globals (`dom/`),
   `window.electronAPI` (master's `createElectronApi` over in-process IPC) and `__stellaUiState`.
   Focus, visibility, size and OS appearance stay in step with that window.
6. The UI generation loads. app-source interface changes go to the UI swap (`setUiSwapTarget`).
   `stella.chat` mirrors the runtime's default conversation (`services/chat-feed.ts`).

`services/headless.ts` boots the same services without an engine. `scripts/session.ts` runs
isolated sessions (own data dir, HOME, protected-storage key, dev test account; a private Xvfb
display on Linux, `RUNE_UNSEEN` windows on macOS, `--show` for a slotted visible one) and drives
them over the control port (`/eval` runs with `api` = the window's electronAPI; `shot` uses the
engine's `/control/screenshot`). `--installed` lets app-source updates move the run's checkout;
prove those from a separate clone.

- On macOS an isolated `HOME` makes Chrome's keychain access hang every https load, so with
  `STELLA_RUNE_ACCOUNT_HOME` set (session.ts sets the real home) the on-demand Chromium gets that
  HOME plus `--use-mock-keychain --password-store=basic`.
- UI and main share one process. An uncaught error whose throwing frame is in the UI bundle
  (`?swap=<n>` sourceURL) skips main's crash handlers and goes to the window's `error` /
  `unhandledrejection` event, as a renderer error does in Chromium (`services/renderer-errors.ts`).
- An app-source update takes the swap the file watcher already started for it, so one update
  builds the UI once.

## How the plugin adapts master's sources

- `electron`, `electron/main`, `electron/common` are virtual modules exporting the shim.
- `browser-script:` imports are built per file as IIFE text, as master's esbuild plugin does.
- Sources under `packages/desktop/electron` see `import.meta.dirname` and `__dirname` as
  `packages/desktop/dist-electron/electron`, the bundle folder their path math assumes.
- `serveRendererSource` is replaced (`services/renderer-source.ts`):
  - the desktop-ui Chromium source worker never runs (it cost ~600 MB);
  - media and canvas protocols are still served;
  - interface changes reach the UI swap.
- The launcher channel on fd 3 works: Bun's `new net.Socket({ fd })` closes at once, so
  `electron/fd-socket.ts` adopts the descriptor when a launcher started the app.

## Master-code changes the Rune branch depends on

These live on rune/desktop only and go to master at ship time:

- `packages/runtime/kernel/computer-use/kernel-worker.ts`: under Bun, the code tool's hardened REPL
  child preloads Node's builtins before it locks `process.binding` (Bun's `node:repl` loads them
  lazily, and some call `process.binding`). Under Rune the REPL child is Bun, not
  Electron-as-Node; without this every agent's `code` tool exits at start. Electron is unaffected.
- `packages/desktop/electron/services/app-source/update-plan.ts`: with `STELLA_LAUNCHER_ENGINE=rune`
  (the launcher's opt-in; the host sets it too), `interfaceOnly()` also matches
  `packages/desktop-rune/ui/`, so a Rune UI draft is added without a click and taken by the UI
  swap, and `relaunches()` also matches `packages/desktop-rune/host/` (the host's own code needs a
  new process). Under Electron both keep master's prefixes.
- `packages/desktop-ui/src/platform/backend/view-fixtures.ts` (read by `useBackendView`): in DEV
  builds only (`import.meta.env.DEV`, set by Electron's Vite dev renderer and by Rune's
  vite-compat bundle), `globalThis.__stellaViewFixtures.set(view, value | "loading")` stands in a
  value for a backend view and `clear(view?)` drops it. Verification stages the same view state in
  both apps with it (the Email workspace side-by-sides); production builds never install it.
- `packages/desktop/electron/services/app-source/web-renderer.ts`: with
  `STELLA_LAUNCHER_ENGINE=rune` and `packages/desktop-rune/web/build.ts` in the checkout, the
  per-user web renderer builds from the Rune `ui/` (WEB.md, "Per-user renderers"): its own inputs,
  uploaded ref `refs/stella/web-renderer-rune` and renderer id. Under Electron it builds
  desktop-ui. Either way it runs whenever the fork holds HEAD (`onForkCurrent`, after a push and
  at launch) and rebuilds when the engine changed since the last upload.
- `packages/theme/color.ts`: `mixOklch` / `mixOklchCss` take an optional powerless-chroma
  threshold and export `CSS_POWERLESS_CHROMA` (0.02), the chroma below which Chromium's
  `color-mix(in oklch)` drops an sRGB colour's hue. `ui/theme`'s `mixOklch` passes it, so
  `mixOklch(primary 18%, #38383a)` is blue like Electron's composer focus border instead of
  purple. The default stays 1e-4, so the theme's derived tokens are unchanged.
- `packages/website/scripts/perf-chat.mjs`: the composer probe also finds the Rune web build's
  composer (`[data-rid^="composer-input:"] > textarea`), so `--variants` compares the two builds.

## Shim coverage (`host/electron`)

| Module | How |
|---|---|
| app | paths (XDG/macOS/Windows), ready/quit/exit/relaunch, switches, metrics. Single-instance lock: Electron's own (see below) |
| ipcMain, webContents IPC | in-process: structured-cloned args, handle/invoke, send, sendSync, `senderFrame.url` = window URL so `assertPrivilegedSender` holds |
| BrowserWindow, BaseWindow, WebContentsView | registry the UI renders as engine `<window>`s; `stella-app:` contents are React trees in the host, other URLs are WebViews; engine window events → Electron events |
| webContents | navigation events, `ready-to-show`, `executeJavaScript` (app: host eval), send, zoom/audio/devtools no-ops. Browser contents (WebContentsView, offscreen, popups of those) are Chromium pages: see "In-app browser" |
| session, protocol, net | custom scheme handlers (served to WebViews via `fetchProtocol`), cookies, webRequest, permission handlers, spellcheck list; `net.fetch` |
| safeStorage | Chromium os_crypt compatible: libsecret v11 / Keychain v10 / DPAPI; dev-harness key file override |
| clipboard, dialog, shell, Menu, Tray, Notification, globalShortcut, screen, nativeTheme | engine API (`electron/engine.ts`) with OS-command fallbacks; message boxes go to a UI-drawn queue (`hostDialogs`) |
| nativeImage | PNG/JPEG/RGBA via photon |
| powerMonitor, powerSaveBlocker | logind PrepareForSleep, /sys battery; systemd-inhibit / caffeinate |
| utilityProcess | Bun fork with `process.parentPort` |
| crashReporter, contentTracing, netLog, autoUpdater, TouchBar, inAppPurchase, … | no-ops |
| desktopCapturer | macOS: ScreenCaptureKit; Windows: monitors and top-level windows (GDI thumbnails, Windows.Graphics.Capture items); both through the engine (`capture.sources`) with Electron ids and PNG thumbnails. Linux: no sources, as master has no Linux caller (Show Stella is macOS/Windows only). |
| app badge | `app.dock.setBadge`/`getBadge` (macOS Dock label), `app.setBadgeCount`, and `BrowserWindow.setOverlayIcon` (Windows: the count from master's "N unread from Stella" description) go to the engine's `app.setBadge`; Linux keeps the count only, as Electron outside Unity (`badge-mac.txt`). |
| systemPreferences | `getMediaAccessStatus` (AVFoundation, CGPreflightScreenCaptureAccess) and `isTrustedAccessibilityClient` (AXIsProcessTrustedWithOptions) over FFI; TCC answers for the engine (DISTRIBUTION.md, "Accessibility"). |

Renderer-only modules (`ipcRenderer`, `contextBridge`, `webFrame`) are undefined, as in main.

## In-app browser and agent browsing (`chromium.ts`, `chromium-page.ts`)

- One headless Chromium per profile (`--headless=new --remote-debugging-pipe`), started on the
  first page and stopped 60 s after its last page closes. Binary: `STELLA_RUNE_CHROMIUM`, a managed
  `runtimes/chrome`, else a system Chrome/Chromium. Persistent sessions keep a `RuneChromium`
  profile in their storage folder; in-memory partitions get a browser context.
- Every WebContentsView and offscreen window loads web URLs as a Chromium target; the
  WebContents keeps Electron's events (did-start-loading, will-navigate, did-navigate(-in-page),
  dom-ready, did-finish-load, did-fail-load with net error codes, page-title-updated,
  render-process-gone) and methods (loadURL, executeJavaScript, capturePage, sendInputEvent,
  insertText, history, reload/stop, setUserAgent).
- `webContents.debugger` is its own flat CDP session on the page, with the child sessions it
  auto-attaches, so master's debugger-target-proxy and InAppBrowserCdpAdapter run unchanged.
- `OffscreenTabs` is replaced (`services/offscreen-tabs.ts`): no host window and no mirror view;
  the panel shows the tab's own view.
- Visible views and popup windows are drawn from `Page.screencastFrame` JPEGs, pushed as blobs
  (≤30 fps) to an `<image>` where main placed the view (`ui/host/HostWindows.tsx`). Input into
  a visible tab waits on the engine's `<surface>` (pointer, wheel, keys, IME).
- Pages carry Chrome's reduced user agent and client hints for the installed version, not
  HeadlessChrome. `window.open` from a page goes to main's window-open handler; an allowed popup
  is a BrowserWindow adopting the target Chromium already opened (opener kept).

## Single-instance lock (`process-singleton.ts`, `v8-value.ts`)

Rune and Electron Stella on one user data folder use one lock. macOS and Linux run Chromium's
POSIX ProcessSingleton exactly: `SingletonLock` → `<hostname>-<pid>` (the engine's pid),
`SingletonSocket` → a socket in a private `.org.chromium.Chromium.*` temp folder, `SingletonCookie`
checked on both sides, Electron's message (`START\0cwd\0argc\0argv…[\0len\0data]`, ACK or
SHUTDOWN reply) and `additionalData` in V8's serializer format inside Blink's envelope. Stale locks
(dead pid) are taken over, as Chromium does.

Windows is not done yet: Electron there uses the named mutex `Local\<app name>ProcessSingletonStartup`,
an exclusive `<userData>\lockfile`, and a message-only window of class `Chrome_MessageWindow` titled
with the user data path that takes `WM_COPYDATA` (`START\0cwd\0cmdline\0base64 data\0`). The window
needs the engine's message loop, so it is engine work; the shim keeps a named pipe until then.

## Chromium-only capabilities and plans

| Capability | Where | Plan |
|---|---|---|
| In-app browser: WebContentsView tabs, offscreen tabs, CDP debugger proxy | `services/in-app-browser*`, `debugger-target-proxy.ts` | Done (section above). Downloads and cookie/permission handlers on browser sessions still to map. |
| Page snapshot (capturePage + debugger) | `services/page-snapshot.ts` | Same on-demand Chromium (CDP `Page.captureScreenshot`, DOM snapshot). |
| Offscreen media probe (video poster, audio peaks, duration) | `services/offscreen-media-probe.ts` | Parity today through master's own fallbacks: the offscreen probe returns null at once and ffmpeg / qlmanage / afconvert / mdls produce poster, duration and peaks (macOS proof). An engine decoder would drop the ffmpeg dependency on Linux and Windows. |
| Realtime voice (WebRTC, shared microphone), WebAudio, MediaSource | desktop-ui `features/voice` (webrtc-media-session, shared-microphone, voice-cues, read-aloud-player, audio-pipeline mic-capture / pcm-player) | Done on macOS through the media page: a system WebView (`ui/host/MediaWebView.tsx`, `stella-media://`) runs those desktop-ui modules unchanged (`host/media/page`, built with Bun on first use, ~21 KB); `ui/replace/features/voice/**` stand-ins carry calls, events, the SDP exchange, pulled response bodies and analyser frames over its message channel (`host/media/media-page.ts`, `protocol.ts`). The page mounts on first use and goes a minute after the last user. It lives in its own `<window kind="background">` (1×1, transparent, click-through, never activates, off captures), which WebKit treats as shown, so voice starts with no Stella window on screen; WebKit starts no page and holds back microphone capture in a window that is not on screen. Proof: GPT-Live voice session, cues, streaming read-aloud, MicCapture/PcmPlayer (`voice-media-page-mac.txt`); voice with every Stella window hidden (`voice-background-window-mac.txt`). WKWebView grants capture itself (wry); a signed bundle still needs `NSMicrophoneUsageDescription` (DISTRIBUTION.md). Linux/Windows: the `<webview microphone>` prop grants the microphone to that page only (master's app session grants `media` only to Stella's own pages); WebKitGTK gets WebRTC switched on, and WebView2 serves custom schemes as `https://<scheme>.<host>` (one mapping in `engine/src/webview.rs`, so pages are secure contexts while TS sees `<scheme>://`). Linux CI asserts the page's caps and a microphone grant on a virtual source (`engine-audio-linux-ci.txt`). Stock WebKitGTK builds (Ubuntu's, and Arch's default flags) have no WebRTC compiled in (`RTCPeerConnection` undefined), so on Linux the page runs in a headless Chrome/Chromium started while voice is in use (`host/media/chromium-media.ts`; `STELLA_RUNE_VOICE_HOST=chromium` forces it elsewhere): the same page at a private `https://stella-media.localhost` origin served through CDP request interception, the microphone granted to that origin only, the bridge over a CDP binding, the browser and its temporary profile gone ~5 s after the last user. Which Chrome it takes is in DISTRIBUTION.md. Linux CI connects a loopback `RTCPeerConnection` pair on the virtual microphone in that page and checks ICE, inbound RTP and received audio (`voice-chromium-linux-ci.txt`); on the Mac the same path starts in 1.8-3.3 s at ~138 MB footprint (`voice-chromium-mac.txt`). WebView2 has WebRTC: Windows CI connects the same loopback in the WebView2 media page (`windows-launch-ci.txt`). |
| Dictation (getUserMedia + AudioWorklet PCM) | desktop-ui `features/dictation` | Done on macOS through master's native `mic_capture` path (16 kHz PCM, live/ended events). |
| Audio output (`Audio`, `HTMLMediaElement`, `setSinkId`) | desktop-ui message sounds, read-aloud, Settings › Audio | macOS: AVPlayer over Bun FFI (`electron/macos-audio-player.ts`, `dom/media-element.ts`), `setSinkId` on CoreAudio output UIDs with Chromium's semantics; `ended` fires once the file's AudioToolbox duration has played (AVPlayer drops its rate ~200 ms later), 399 ms for a 313 ms sound against Electron's 373 ms (`audio-ended-mac.txt`). Linux/Windows: the engine's player (`engine/src/audio.rs`: symphonia decodes MP3, AAC/M4A, WAV, FLAC and Ogg Vorbis; cpal plays to the chosen output, or into a silent real-time sink when there is none, as Chromium does) through `electron/audio-player.ts`; `enumerateDevices` and `setSinkId` use cpal's device names. WebAudio and MediaSource (voice cues, streaming read-aloud) run in the media page (row above). |
| Devices and media access | `navigator.mediaDevices.enumerateDevices`, `systemPreferences` | macOS: CoreAudio devices in `MediaDeviceInfo` shape with `default` entries; `getMediaAccessStatus` from AVFoundation / CGPreflightScreenCaptureAccess. `askForMediaAccess` reports the status without prompting: the prompt needs the signed engine bundle with `NSMicrophoneUsageDescription` (DISTRIBUTION.md). |
| Wakeword | `services/wakeword-service.ts` | Already a native helper; runs unchanged. |
| Meeting capture | `services/meeting-capture-controller.ts` | Master's `meeting_capture` helper (macOS and Windows; Electron has none on Linux) and its IPC run unchanged; nothing in desktop-ui calls `electronAPI.meetings` today. macOS: start/status/stop through `api.meetings`, system audio and microphone in 5 s WAV segments (`meeting-capture-mac.txt`). Windows: Windows CI builds the helper and runs the same calls. |
| Show Stella recording (desktopCapturer + getUserMedia desktop + MediaRecorder) | `show-stella-controller.ts`, desktop-ui `show-stella-recorder.ts` | macOS: done. `ui/replace/features/show-stella/show-stella-recorder.ts` records through the engine (`engine/src/capture.rs`): ScreenCaptureKit into an H.264 MP4 with the microphone as AAC (macOS 15+), JPEG frames every interval, 16 kHz PCM for the WAV; it sends to the controller through the overlay window's own `showStella` API. Global input for the timeline and ink is `uiohook-napi` resolved to `electron/uiohook.ts` over the engine's listen-only CGEventTap (`engine/src/inputhook.rs`); the addon itself crashes Bun. Windows: the same engine API over Windows.Graphics.Capture frames encoded by Media Foundation (H.264 MP4 with the microphone as AAC, paced so a still screen keeps its frame rate), and a listen-only `WH_MOUSE_LL`/`WH_KEYBOARD_LL` hook on its own thread for `uiohook`; Windows CI records the screen and reads synthesized input through the hook (`scripts/ci/capture-check.js`). Linux: master offers Show Stella only on macOS and Windows (`show-stella-controller.ts`), so there is nothing to port; a Linux port would record through the xdg-desktop-portal ScreenCast + PipeWire, and Wayland gives no app a global input hook (X11 sessions could use XInput2 raw events, as uiohook does). |
| Office / PDF previews, map route, canvas tab, cloud app panel, cloud browser takeover (iframes) | desktop-ui `app/chat/*Card`, `shell/display/*` | Engine `<webview>` element (system WebView) with the custom schemes served by `session.fetchProtocol`; PDF thumbnails through pdf.js in that WebView, or native pdfium. |
| Auth challenge (Turnstile window) | `services/auth-service.ts` | An engine `<window>` holding a `<webview>` on the auth partition. The page's main-frame `stella://turnstile?token=…` reaches auth's will-navigate as in Electron (macOS navigations carry `mainFrame` too); a hidden window has no native window, so the page starts at auth's `show()`. Proof: token in 4.9 s and a magic-link sign-in from the UI (`turnstile-magic-link-mac.txt`). |
| Update transition still frame (capturePage) | `app-source/update-transition.ts` | Engine screenshot of its own surface. |
| Draft preview (WebContentsView of the draft's UI) | `app-source/draft-preview.ts` | A second host process running the draft's `ui/` into an engine panel window. |
| Region capture effect (WebGL) | desktop-ui `shell/overlay/region-capture-vacuum.ts` | Engine animation/shader. |
| Spellcheck | session spellchecker | OS/engine spellcheck (hunspell on Linux) or off. |

## Measured (Linux, Xvfb + lavapipe, dev test account, after a chat turn)

| Process | PSS |
|---|---|
| engine | 113 MB |
| host (Electron main + UI) | 80 MB |
| runtime worker | 102 MB |
| UI builder child | 12 MB |

The total is ~308 MB. With the desktop-ui source worker, before it was replaced, the host alone was 705 MB.

- Boot: Electron main evaluates in ~180 ms; first content frame ~350 ms after spawn.
- A chat reply renders ~3.4 s after Return.
- Hot swap: ~10–25 ms bundle and load, ~1.5 ms render and send.
- Host RSS over 100 swaps: 114 → 111 MB once swaps settle.

## Measured (macOS 15.6, MacBook Air arm64, dev test account, idle)

`footprint` per process (Activity Monitor's Memory), same rune/desktop tree for both apps:

| | Electron Stella (verify-stella copy) | Rune Stella |
|---|---|---|
| Total | ~569 MB (RSS 773) | ~372–398 MB |
| Parts | main 251, GPU 40, utilities 19, renderers 155, runtime worker 104 | engine 160–175, host 114–125, runtime worker 98 |

- The launchers and session.ts run the engine with `MIMALLOC_PURGE_DELAY=0`; the host fell from
  ~167 to 114–125 MB with it.
- The UI builder child exists only while building (220–355 MB RSS) and stops 20 s after the last
  build.
- Quit: a SIGTERM to the engine ends the runtime worker in ~0.6 s and everything in ~1.8 s.
- An app-source draft that edits `ui/` applies in ~380 ms with one swap (bundle and load 150–220
  ms warm, ~560–880 ms on the first swap after boot); Undo is the same.
