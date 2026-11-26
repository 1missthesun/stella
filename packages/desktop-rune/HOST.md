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
isolated sessions (own data dir, HOME, protected-storage key, dev test account, a private Xvfb
display) and drives them over the control port (`/eval` runs with `api` = the window's
electronAPI).

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
| desktopCapturer | returns no sources (see Show Stella below) |

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
| Offscreen media probe (video poster, audio peaks, duration) | `services/offscreen-media-probe.ts` | Native: decode in the host/engine (ffmpeg if present, else the engine's media decoder). A hidden engine WebView is the fallback; no Chromium. |
| Realtime voice (WebRTC, shared microphone) | desktop-ui `features/voice` | Native: engine audio I/O (capture/playback via cpal, echo cancellation) plus the realtime API's WebSocket audio transport in the host. A hidden WebView with WebRTC is the fallback on platforms whose WebView has it (WebView2, WKWebView). |
| Dictation (getUserMedia + AudioWorklet PCM) | desktop-ui `features/dictation` | Native: the same engine microphone stream, PCM frames to the host over the bridge. |
| Wakeword | `services/wakeword-service.ts` | Already a native helper; runs unchanged. |
| Meeting capture | `services/meeting-capture-controller.ts` | Already a native helper; runs unchanged. macOS microphone status needs `systemPreferences.getMediaAccessStatus` from the engine. |
| Show Stella recording (desktopCapturer + getUserMedia desktop + MediaRecorder) | `show-stella-controller.ts`, desktop-ui `show-stella-recorder.ts` | Native capture in the engine (PipeWire/xdg-desktop-portal ScreenCast, ScreenCaptureKit, Windows.Graphics.Capture), encoded by the existing screen-recording helper; `desktopCapturer.getSources` then lists the engine's displays. |
| Office / PDF previews, map route, canvas tab, cloud app panel, cloud browser takeover (iframes) | desktop-ui `app/chat/*Card`, `shell/display/*` | Engine `<webview>` element (system WebView) with the custom schemes served by `session.fetchProtocol`; PDF thumbnails through pdf.js in that WebView, or native pdfium. |
| Auth challenge (Turnstile window) | `services/auth-service.ts` | An engine `<window>` holding a `<webview>` on the auth partition. |
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
