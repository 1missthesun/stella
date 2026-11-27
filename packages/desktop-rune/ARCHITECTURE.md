# Stella on Rune

Stella's desktop app without Electron: a compiled Rune engine draws every window, and Stella's whole
app (services and UI) is TypeScript running in one Bun process. Branch `rune/desktop`; nothing here
ships until Rahul says so.

## Processes

```
stella-engine (Rust, Rune)                 bun host/main.tsx (one process)
  windows, GPU, Taffy layout, Parley text    host/bridge      protocol client
  input, IME, spellcheck, AccessKit           host/reconciler  React 19 → engine tree
  scrolling, springs, selection               host/electron    `electron` module for Bun
  menus, tray, global shortcuts               host/dom         window/localStorage/... for UI logic
  clipboard, dialogs, notifications           host/services    Electron-main services, unchanged
  drag and drop, file drops                   ui/**            the app (hot-swapped, self-modified)
  lazy OS WebViews (wry)          ◄─binary─   
                                  ─JSON────►  runtime worker (unchanged Bun process)
                                              on demand: Chromium for agent browsing
```

- The engine spawns the host and owns nothing app-specific. It never runs app logic.
- `packages/desktop/electron/**` (Electron main) runs inside the host under Bun with `electron`
  resolved to `host/electron` (a Bun plugin). Service code stays on master's files so the branch
  rebases cleanly; the shim covers app, ipcMain, BrowserWindow (→ engine windows), webContents.send
  (→ UI host), shell, dialog, clipboard, nativeTheme, nativeImage, screen, powerMonitor,
  globalShortcut, Menu, Tray, Notification, safeStorage, session/protocol (→ WebViews), net.
- `window.electronAPI` in the UI is master's `createElectronApi(ipc)` over an in-process ipc that
  calls the handlers `ipcMain.handle` registered. Same contract, no Chromium IPC.
- Browser-only APIs (WebRTC voice, getUserMedia, pdf.js, office previews) run in an on-demand
  hidden WebView; agent browsing (CDP) runs in a Chromium started only when an agent browses.
- HTML deliverables, canvases and Cloud Apps render unchanged in lazy OS WebViews (`<webview>`):
  WKWebView (macOS), WebView2 (Windows), WebKitGTK child (Linux X11, XWayland under Wayland, as
  Electron Stella runs); none on a forced native Wayland backend (see host/ELEMENTS.md).

## Bridge (host/bridge.ts ⇄ engine/src/protocol.rs)

- TS → engine: length-prefixed binary frames, one per React commit: CREATE, PROPS (JSON),
  APPEND, INSERT, REMOVE, COMMIT, CMD (JSON, optional request id for replies).
- Engine → TS: JSON lines: element events (press, input, submit, key, focus, layout, scroll,
  hover, drop, contextmenu, link), window events, menu/tray/shortcut events, replies.
- Windows are elements: `<window>` children of the root, so React portals open, update and close
  windows (main, detached viewers, companion, overlays). Each window commits independently.
- Hover, press, scrolling, selection, typing, IME, focus rings and every animation run in the
  engine at display rate. Only state changes cross the bridge.

## UI (ui/)

- `ui/kit` Stella's design system on the host elements (buttons, menus, popovers, dialogs,
  tooltips, switches, fields, tabs, toasts, Markdown, code, icons), themed from `@stella/theme`.
- `ui/shell`, `ui/chat`, `ui/settings`, ... mirror `packages/desktop-ui/src` surface by surface.
  Non-visual logic (stores, hooks, contracts, i18n catalogs) is imported from desktop-ui and
  `@stella/contracts`, not copied, whenever it runs without the DOM.
- State lives in stores outside hot-swapped modules: a live edit keeps everything.
- The same `ui/` builds for the web (stella.sh/chat) through a DOM host that implements the host
  elements with react-dom.

## Ground rules

- Unit tests are banned: never write, update or run them. Prove in the real running app
  (`scripts/xvfb.sh` private display for screenshots; real-display runs only floating and
  unfocused), plus typecheck, lint and builds.
- Keep master's files unchanged unless a change is needed; new code lives in this package.
- Rune is pinned at `github.com/1missthesun/rune` (private mirror, branch `stella`). Engine-side
  Rune fixes go there as commits on `stella`; bump the `rev` in `engine/Cargo.toml`.
